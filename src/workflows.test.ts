import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

// GitHub's default job timeout is 6 hours, and a Mac minute bills as 10 on this private repo: a hung e2e cost ~2 h (#141).
const dir = new URL('../.github/workflows/', import.meta.url)
const read = (file: string) => readFileSync(new URL(file, dir), 'utf8')

// shortcut: reads job keys by their 2-space indent in the jobs: block, and wants a plain number (an expression such as
// ${{ vars.T }} can be empty); upgrade to a YAML parser if a workflow ever lays jobs out differently.
const jobs = (yml: string) =>
  // a Windows checkout has CRLF; a file with no jobs: block fails the length check below, not with a TypeError
  (yml.replaceAll('\r\n', '\n').split(/^jobs:\n/m)[1] ?? '')
    .split(/^[\w"']/m)[0] // the jobs: block ends at the next top-level key
    .split(/^ {2}(?=["']?[\w-]+["']?:[ \t]*(?:#.*)?\n)/m)
    .slice(1)
    .map((block) => ({
      name: block.slice(0, block.indexOf(':')),
      // GitHub rejects timeout-minutes on a job that calls a reusable workflow: that workflow's own jobs set it
      reusable: /^ {4}uses:/m.test(block),
      timeout: block.match(/^ {4}timeout-minutes: (\d+)\b/m)?.[1],
    }))

test('every job in every workflow sets timeout-minutes', () => {
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))
  expect(files).toEqual(expect.arrayContaining(['ci.yml', 'release.yml']))
  for (const file of files) {
    const all = jobs(read(file))
    expect(all.length, file).toBeGreaterThan(0)
    for (const job of all) if (!job.reusable) expect(job.timeout, `${file} job ${job.name}`).toBeDefined()
  }
})

test('the CI check job stops at 20 minutes', () => {
  expect(jobs(read('ci.yml')).find((j) => j.name === 'check')?.timeout).toBe('20')
})
