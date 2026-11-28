import { expect, it } from 'vitest'
import { addRecent, removeRecent } from './recent-projects'

it('puts the opened Project first without duplicates and keeps the last 8', () => {
  expect(addRecent(['b', 'a', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  const ten = Array.from({ length: 10 }, (_, i) => String(i))
  expect(addRecent(ten, 'new')).toEqual(['new', ...ten.slice(0, 7)])
})

it('removes only a Project already on the list', () => {
  expect(removeRecent(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  expect(() => removeRecent(['a'], 'b')).toThrow('b is not a recent Project')
  expect(() => removeRecent(['a'], 1)).toThrow('1 is not a recent Project')
})
