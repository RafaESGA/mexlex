export type SilLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
};

export const silLogger: SilLogger = {
  info(message, context) {
    console.log(`[sil] ${message}`, context ?? {});
  },
  error(message, context) {
    console.error(`[sil] ${message}`, context ?? {});
  }
};

