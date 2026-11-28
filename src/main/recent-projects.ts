/** The recent Projects list after opening dir: dir first, no duplicates, at most 8. */
export const addRecent = (list: string[], dir: string) => [dir, ...list.filter((d) => d !== dir)].slice(0, 8)

/** The list without dir. Only a Project already on it: the page names which, it never names a path to act on. */
export function removeRecent(list: string[], dir: unknown) {
  if (typeof dir !== 'string' || !list.includes(dir)) throw new Error(`${dir} is not a recent Project`)
  return list.filter((d) => d !== dir)
}
