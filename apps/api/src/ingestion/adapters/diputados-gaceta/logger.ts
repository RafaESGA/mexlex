export const diputadosGacetaLogger = {
  info(message: string, context?: Record<string, unknown>) {
    console.log(`[diputados-gaceta] ${message}`, context ?? {});
  },
  error(message: string, context?: Record<string, unknown>) {
    console.error(`[diputados-gaceta] ${message}`, context ?? {});
  }
};

