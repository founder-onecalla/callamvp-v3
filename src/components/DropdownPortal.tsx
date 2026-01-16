import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface DropdownPortalProps {
  isOpen: boolean
  onClose: () => void
  triggerRef: React.RefObject<HTMLElement | null>
  children: ReactNode
  align?: 'left' | 'right'
  className?: string
}

/**
 * Portal-based dropdown that renders at document.body level.
 *
 * This solves z-index/stacking-context issues by:
 * 1. Rendering outside parent stacking contexts via portal
 * 2. Using very high z-index (9999)
 * 3. Ensuring opaque background
 * 4. Not being clipped by parent overflow
 */
export default function DropdownPortal({
  isOpen,
  onClose,
  triggerRef,
  children,
  align = 'right',
  className = '',
}: DropdownPortalProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0, right: 0 })

  // Calculate position based on trigger element
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return

    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return

      const rect = trigger.getBoundingClientRect()
      const scrollY = window.scrollY
      const scrollX = window.scrollX

      setPosition({
        top: rect.bottom + scrollY + 4, // 4px gap below trigger
        left: rect.left + scrollX,
        right: window.innerWidth - rect.right - scrollX,
      })
    }

    updatePosition()

    // Update on scroll/resize
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [isOpen, triggerRef])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node

      // Don't close if clicking on trigger or dropdown
      if (triggerRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return

      onClose()
    }

    // Use mousedown for faster response
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose, triggerRef])

  // Close on escape key
  useEffect(() => {
    if (!isOpen) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const positionStyle: React.CSSProperties = {
    position: 'fixed',
    top: position.top,
    ...(align === 'right' ? { right: position.right } : { left: position.left }),
    zIndex: 9999,
  }

  return createPortal(
    <div
      ref={dropdownRef}
      style={positionStyle}
      className={`bg-white border border-gray-200 rounded-xl shadow-lg py-1 ${className}`}
    >
      {children}
    </div>,
    document.body
  )
}
