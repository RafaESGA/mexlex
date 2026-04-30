export const senadoGacetaLogger = {
  info(message: string, context?: Record<string, unknown>) {
    console.log(`[senado-gaceta] ${message}`, context ?? {});
  },
  error(message: string, context?: Record<string, unknown>) {
    console.error(`[senado-gaceta] ${message}`, context ?? {});
  }
};
