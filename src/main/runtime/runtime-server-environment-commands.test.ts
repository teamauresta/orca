import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RuntimeServerEnvironmentCommands } from './runtime-server-environment-commands'

// Windows creates directory links without admin rights only as junctions.
const dirLinkType = process.platform === 'win32' ? 'junction' : 'dir'

describe('server folder browsing', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-browse-'))
    await mkdir(join(root, 'real-projects'))
    await writeFile(join(root, 'notes.txt'), 'x')
    await symlink(join(root, 'real-projects'), join(root, 'Projects'), dirLinkType)
    await symlink(join(root, 'notes.txt'), join(root, 'notes-link'), 'file').catch(() => {})
    await symlink(join(root, 'missing'), join(root, 'dangling'), dirLinkType)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('lists a link to a folder as a folder the user can open', async () => {
    const { entries } = await new RuntimeServerEnvironmentCommands().browseDirectory(root)

    expect(entries.find((entry) => entry.name === 'Projects')).toEqual({
      name: 'Projects',
      isDirectory: true,
      isSymlink: true
    })
  })

  it('keeps links to files and broken links out of the folders', async () => {
    const { entries } = await new RuntimeServerEnvironmentCommands().browseDirectory(root)
    const byName = new Map(entries.map((entry) => [entry.name, entry]))

    expect(byName.get('dangling')?.isDirectory).toBe(false)
    if (byName.has('notes-link')) {
      expect(byName.get('notes-link')?.isDirectory).toBe(false)
    }
    expect(byName.get('real-projects')).toEqual({
      name: 'real-projects',
      isDirectory: true,
      isSymlink: false
    })
  })
})
