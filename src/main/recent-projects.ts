/** The recent Projects list after opening dir: dir first, no duplicates, at most 8. */
export const addRecent = (list: string[], dir: string) => [dir, ...list.filter((d) => d !== dir)].slice(0, 8)
