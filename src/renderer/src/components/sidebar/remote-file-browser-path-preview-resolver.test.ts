import { describe, expect, it } from 'vitest'
import type { DirEntry } from '../../../../shared/filesystem-entry-types'
import { resolvePathInput, type PreviewState } from './remote-file-browser-path-preview-resolver'

const dir = (name: string): DirEntry => ({ name, isDirectory: true, isSymlink: false })

// Listings keyed by path; a missing key behaves like a folder the server may not read.
function fakeHost(listings: Record<string, DirEntry[]>) {
  return async (path: string) => {
    const entries = listings[path]
    if (!entries) {
      throw new Error(`EACCES: permission denied, scandir '${path}'`)
    }
    return { resolvedPath: path, entries, pathFlavor: 'posix' as const }
  }
}

async function resolve(raw: string, listings: Record<string, DirEntry[]>) {
  const state: { preview: PreviewState | null } = { preview: null }
  await resolvePathInput({
    raw,
    resolvedPath: '/',
    pathFlavor: 'posix',
    fetchListing: fakeHost(listings),
    homePathRef: { current: '/home/orca' },
    previewGenRef: { current: 0 },
    lastCommittedPrefixRef: { current: '' },
    setPreview: (next) => {
      state.preview = typeof next === 'function' ? next(state.preview) : next
    }
  })
  return state.preview
}

describe('typed path resolution', () => {
  it('reaches a readable folder under a parent the host may enter but not list', async () => {
    const preview = await resolve('/home/dyan/Projects/', {
      '/': [dir('home')],
      '/home': [dir('dyan'), dir('orca')],
      '/home/dyan/Projects': [dir('anatomy')]
    })

    expect(preview).toMatchObject({
      resolvedPath: '/home/dyan/Projects',
      entries: [dir('anatomy')],
      error: null,
      loading: false
    })
  })

  it('still corrects the case of a segment in a listable parent', async () => {
    const preview = await resolve('/home/DYAN/', {
      '/': [dir('home')],
      '/home': [dir('dyan')],
      '/home/dyan': [dir('Projects')]
    })

    expect(preview).toMatchObject({ resolvedPath: '/home/dyan', error: null })
  })

  it('reports the unreadable folder when the typed path cannot be reached', async () => {
    const preview = await resolve('/home/dyan/private/', {
      '/': [dir('home')],
      '/home': [dir('dyan')]
    })

    expect(preview?.error).toContain('/home/dyan/private')
    expect(preview?.loading).toBe(false)
  })
})
