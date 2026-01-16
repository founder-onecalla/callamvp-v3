import { describe, it, expect } from 'vitest'
import { STATUS_LABELS, STATUS_COLORS, ROLE_COLORS } from './types'
import type { CallCardStatus } from './types'

describe('types', () => {
  describe('STATUS_LABELS', () => {
    it('has labels for all status types', () => {
      const statuses: CallCardStatus[] = [
        'in_progress',
        'completed',
        'no_answer',
        'busy',
        'failed',
        'voicemail',
        'canceled',
      ]
      
      statuses.forEach((status) => {
        expect(STATUS_LABELS[status]).toBeDefined()
        expect(typeof STATUS_LABELS[status]).toBe('string')
        expect(STATUS_LABELS[status].length).toBeGreaterThan(0)
      })
    })
  })

  describe('STATUS_COLORS', () => {
    it('has color config for all status types', () => {
      const statuses: CallCardStatus[] = [
        'in_progress',
        'completed',
        'no_answer',
        'busy',
        'failed',
        'voicemail',
        'canceled',
      ]
      
      statuses.forEach((status) => {
        expect(STATUS_COLORS[status]).toBeDefined()
        expect(STATUS_COLORS[status].bg).toBeDefined()
        expect(STATUS_COLORS[status].text).toBeDefined()
        expect(STATUS_COLORS[status].dot).toBeDefined()
      })
    })

    it('uses Tailwind class naming convention', () => {
      Object.values(STATUS_COLORS).forEach((colors) => {
        expect(colors.bg).toMatch(/^bg-/)
        expect(colors.text).toMatch(/^text-/)
        expect(colors.dot).toMatch(/^bg-/)
      })
    })
  })

  describe('ROLE_COLORS', () => {
    it('has distinct colors for different roles', () => {
      expect(ROLE_COLORS.user.bubble).not.toBe(ROLE_COLORS.onecalla_chat.bubble)
      expect(ROLE_COLORS.onecalla_call.bubble).not.toBe(ROLE_COLORS.other_party.bubble)
    })

    it('uses teal for OneCalla in call context', () => {
      expect(ROLE_COLORS.onecalla_call.bubble).toMatch(/teal/)
    })

    it('uses blue for user messages', () => {
      expect(ROLE_COLORS.user.bubble).toMatch(/blue/)
    })
  })
})
