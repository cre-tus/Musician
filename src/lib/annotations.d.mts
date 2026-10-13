export const ANNOTATION_TOKEN: '[주석]';
export function stageAnnotation(full: string): void;
export function stagedAnnotationCount(): number;
export function resolveAnnotations(text: string): { text: string; used: number };
export function clearAnnotations(): void;
