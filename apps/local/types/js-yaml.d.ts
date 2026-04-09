declare module "js-yaml" {
  export interface DumpOptions {
    lineWidth?: number;
    noRefs?: boolean;
    sortKeys?: boolean;
  }

  export interface LoadOptions {
    filename?: string;
  }

  export function dump(value: unknown, options?: DumpOptions): string;
  export function load(value: string, options?: LoadOptions): unknown;
}
