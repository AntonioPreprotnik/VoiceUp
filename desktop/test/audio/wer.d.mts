export declare function normalizeWords(text: string): string[]
export declare function editDistance(reference: string[], heard: string[]): number
export declare function wordErrors(
  referenceText: string,
  heardText: string
): { errors: number; words: number }
