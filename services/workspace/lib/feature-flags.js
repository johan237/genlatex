export function getFeatureFlags() {
  return {
    research_intake_v1: false,  // Research intake removed (GenLaTeX prompt-only mode)
  };
}

export function isFeatureEnabled(flagName) {
  return !!getFeatureFlags()[flagName];
}

