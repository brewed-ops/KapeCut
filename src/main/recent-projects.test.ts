import { expect, it } from 'vitest'
import { addRecent } from './recent-projects'

it('puts the opened Project first without duplicates and keeps the last 8', () => {
  expect(addRecent(['b', 'a', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  const ten = Array.from({ length: 10 }, (_, i) => String(i))
  expect(addRecent(ten, 'new')).toEqual(['new', ...ten.slice(0, 7)])
})
