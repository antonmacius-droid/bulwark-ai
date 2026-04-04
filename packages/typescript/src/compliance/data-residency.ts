/**
 * Data Residency & Cross-Border Transfer Controls
 *
 * DISCLAIMER: Provider region mappings are based on publicly available documentation
 * and may change without notice. Verify data processing locations directly with each
 * provider. This module does not replace legal assessment of cross-border data transfers.
 *
 * Implements:
 * - Provider region tracking (where does data go?)
 * - Region restriction (block requests to providers outside allowed regions)
 * - Transfer impact assessment logging
 * - Schrems II / EU-US Data Privacy Framework compliance
 */

export interface DataResidencyConfig {
  enabled: boolean;
  /** Allowed regions for data processing. If set, blocks providers outside these regions. */
  allowedRegions?: string[];
  /** Block cross-border transfers entirely */
  blockCrossBorder?: boolean;
  /** Log all cross-border transfers */
  logTransfers?: boolean;
  /** Your organization's primary region */
  primaryRegion?: string;
}

/** Known provider data processing regions */
export const PROVIDER_REGIONS: Record<string, { regions: string[]; headquarters: string; dpf: boolean; description: string }> = {
  openai: {
    regions: ["US"],
    headquarters: "US",
    dpf: true, // EU-US Data Privacy Framework certified
    description: "Data processed in US. DPF certified. Azure regions available for enterprise.",
  },
  anthropic: {
    regions: ["US"],
    headquarters: "US",
    dpf: true,
    description: "Data processed in US. GCP regions configurable for enterprise.",
  },
  mistral: {
    regions: ["EU", "FR"],
    headquarters: "FR",
    dpf: false, // EU-based, no cross-border
    description: "Data processed in EU (France). No cross-border transfer.",
  },
  google: {
    regions: ["US", "EU"],
    headquarters: "US",
    dpf: true,
    description: "Data processed in US or EU depending on configuration.",
  },
  ollama: {
    regions: ["LOCAL"],
    headquarters: "LOCAL",
    dpf: false,
    description: "Data processed locally. Never leaves your infrastructure.",
  },
  azure: {
    regions: ["US", "EU", "UK", "APAC"],
    headquarters: "US",
    dpf: true,
    description: "Region configurable. EU data residency available.",
  },
};

export interface TransferAssessment {
  provider: string;
  sourceRegion: string;
  destinationRegions: string[];
  crossBorder: boolean;
  dpfCertified: boolean;
  allowed: boolean;
  reason?: string;
}

export class DataResidencyManager {
  private config: DataResidencyConfig;

  constructor(config: DataResidencyConfig) {
    this.config = config;
  }

  /** Assess whether a transfer to a provider is allowed */
  assessTransfer(provider: string): TransferAssessment {
    const providerInfo = PROVIDER_REGIONS[provider] || { regions: ["UNKNOWN"], headquarters: "UNKNOWN", dpf: false, description: "" };
    const source = this.config.primaryRegion || "EU";
    const crossBorder = !providerInfo.regions.includes(source) && !providerInfo.regions.includes("LOCAL");

    let allowed = true;
    let reason: string | undefined;

    // Block if cross-border transfers are disabled
    if (this.config.blockCrossBorder && crossBorder) {
      allowed = false;
      reason = `Cross-border transfer blocked: ${provider} processes data in ${providerInfo.regions.join(", ")}, your region is ${source}`;
    }

    // Block if provider region not in allowed list
    if (this.config.allowedRegions && this.config.allowedRegions.length > 0) {
      const hasAllowedRegion = providerInfo.regions.some(r => this.config.allowedRegions!.includes(r));
      if (!hasAllowedRegion) {
        allowed = false;
        reason = `Provider ${provider} operates in ${providerInfo.regions.join(", ")} which is not in allowed regions: ${this.config.allowedRegions.join(", ")}`;
      }
    }

    return {
      provider,
      sourceRegion: source,
      destinationRegions: providerInfo.regions,
      crossBorder,
      dpfCertified: providerInfo.dpf,
      allowed,
      reason,
    };
  }

  /** Get all providers with their data residency status */
  getProviderMap(): Record<string, TransferAssessment> {
    const map: Record<string, TransferAssessment> = {};
    for (const provider of Object.keys(PROVIDER_REGIONS)) {
      map[provider] = this.assessTransfer(provider);
    }
    return map;
  }

  /** Generate a Transfer Impact Assessment (TIA) report — required for GDPR cross-border */
  generateTIA(): {
    primaryRegion: string;
    allowedRegions: string[];
    providers: TransferAssessment[];
    crossBorderCount: number;
    blockedCount: number;
    recommendations: string[];
  } {
    const providers = Object.keys(PROVIDER_REGIONS).map(p => this.assessTransfer(p));
    const crossBorder = providers.filter(p => p.crossBorder);
    const blocked = providers.filter(p => !p.allowed);

    const recommendations: string[] = [];
    if (crossBorder.length > 0 && !this.config.allowedRegions) {
      recommendations.push("Consider setting allowedRegions to restrict data flow");
    }
    const nonDpf = crossBorder.filter(p => !p.dpfCertified && p.allowed);
    if (nonDpf.length > 0) {
      recommendations.push(`Providers without DPF certification: ${nonDpf.map(p => p.provider).join(", ")}. Consider Standard Contractual Clauses (SCCs).`);
    }
    if (!crossBorder.some(p => p.provider === "ollama")) {
      recommendations.push("Consider Ollama for maximum data residency — data never leaves your infrastructure");
    }
    if (crossBorder.some(p => p.provider === "mistral")) {
      recommendations.push("Mistral is EU-based (France) — ideal for EU data residency requirements");
    }

    return {
      primaryRegion: this.config.primaryRegion || "EU",
      allowedRegions: this.config.allowedRegions || ["ALL"],
      providers,
      crossBorderCount: crossBorder.length,
      blockedCount: blocked.length,
      recommendations,
    };
  }
}
