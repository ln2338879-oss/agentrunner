export function needsDesignChoice(text: string): boolean {
  return /골라|선택|결정|컨펌|취향|의견|견해/.test(text);
}
