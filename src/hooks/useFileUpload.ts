import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'

// File constraints
export const FILE_CONSTRAINTS = {
  maxFiles: 10,
  maxSizeBytes: 20 * 1024 * 1024, // 20 MB
  maxSizeMB: 20,
  acceptedTypes: {
    images: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
    documents: ['application/pdf'],
    audio: ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/m4a', 'audio/x-m4a'],
  },
  acceptedExtensions: '.png,.jpg,.jpeg,.webp,.pdf,.mp3,.wav,.m4a',
}

export interface UploadedFile {
  id: string
  file: File
  name: string
  size: number
  type: string
  status: 'pending' | 'uploading' | 'completed' | 'error'
  progress: number
  url?: string
  error?: string
  previewUrl?: string
}

interface UseFileUploadOptions {
  onError?: (error: string) => void
  onUploadComplete?: (file: UploadedFile) => void
}

interface UseFileUploadReturn {
  files: UploadedFile[]
  isUploading: boolean
  addFiles: (fileList: FileList | File[]) => void
  removeFile: (id: string) => void
  clearFiles: () => void
  uploadFiles: () => Promise<UploadedFile[]>
  getCompletedFiles: () => UploadedFile[]
}

// Generate unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// Check if file type is accepted
function isAcceptedType(file: File): boolean {
  const allAccepted = [
    ...FILE_CONSTRAINTS.acceptedTypes.images,
    ...FILE_CONSTRAINTS.acceptedTypes.documents,
    ...FILE_CONSTRAINTS.acceptedTypes.audio,
  ]
  return allAccepted.includes(file.type)
}

// Get file category
export function getFileCategory(file: File): 'image' | 'document' | 'audio' | 'unknown' {
  if (FILE_CONSTRAINTS.acceptedTypes.images.includes(file.type)) return 'image'
  if (FILE_CONSTRAINTS.acceptedTypes.documents.includes(file.type)) return 'document'
  if (FILE_CONSTRAINTS.acceptedTypes.audio.includes(file.type)) return 'audio'
  return 'unknown'
}

// Format file size for display
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function useFileUpload(options: UseFileUploadOptions = {}): UseFileUploadReturn {
  const { onError, onUploadComplete } = options
  const { user } = useAuth()
  const [files, setFiles] = useState<UploadedFile[]>([])

  const isUploading = files.some(f => f.status === 'uploading')

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const newFiles = Array.from(fileList)
    const validFiles: UploadedFile[] = []
    const errors: string[] = []

    // Check total count
    const currentCount = files.length
    const availableSlots = FILE_CONSTRAINTS.maxFiles - currentCount

    if (availableSlots <= 0) {
      onError?.(`Maximum ${FILE_CONSTRAINTS.maxFiles} files allowed`)
      return
    }

    const filesToAdd = newFiles.slice(0, availableSlots)

    for (const file of filesToAdd) {
      // Check file size
      if (file.size > FILE_CONSTRAINTS.maxSizeBytes) {
        errors.push(`${file.name} exceeds ${FILE_CONSTRAINTS.maxSizeMB}MB limit`)
        continue
      }

      // Check file type
      if (!isAcceptedType(file)) {
        errors.push(`${file.name} is not a supported file type`)
        continue
      }

      // Create preview URL for images
      let previewUrl: string | undefined
      if (getFileCategory(file) === 'image') {
        previewUrl = URL.createObjectURL(file)
      }

      validFiles.push({
        id: generateId(),
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'pending',
        progress: 0,
        previewUrl,
      })
    }

    // Report errors
    if (errors.length > 0) {
      onError?.(errors.join('. '))
    }

    // Report if some files were skipped due to limit
    if (newFiles.length > availableSlots) {
      onError?.(`Only ${availableSlots} more file(s) can be added`)
    }

    if (validFiles.length > 0) {
      setFiles(prev => [...prev, ...validFiles])
    }
  }, [files.length, onError])

  const removeFile = useCallback((id: string) => {
    setFiles(prev => {
      const file = prev.find(f => f.id === id)
      // Revoke preview URL to free memory
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl)
      }
      return prev.filter(f => f.id !== id)
    })
  }, [])

  const clearFiles = useCallback(() => {
    // Revoke all preview URLs
    files.forEach(f => {
      if (f.previewUrl) {
        URL.revokeObjectURL(f.previewUrl)
      }
    })
    setFiles([])
  }, [files])

  const uploadFiles = useCallback(async (): Promise<UploadedFile[]> => {
    if (!user) {
      onError?.('You must be logged in to upload files')
      return []
    }

    const pendingFiles = files.filter(f => f.status === 'pending')
    if (pendingFiles.length === 0) {
      return files.filter(f => f.status === 'completed')
    }

    const uploadPromises = pendingFiles.map(async (uploadFile) => {
      // Update status to uploading
      setFiles(prev => prev.map(f => 
        f.id === uploadFile.id ? { ...f, status: 'uploading' as const, progress: 10 } : f
      ))

      try {
        // Generate unique file path
        const fileExt = uploadFile.name.split('.').pop()
        const filePath = `${user.id}/${Date.now()}-${uploadFile.id}.${fileExt}`

        // Upload to Supabase Storage
        const { data, error } = await supabase.storage
          .from('attachments')
          .upload(filePath, uploadFile.file, {
            cacheControl: '3600',
            upsert: false,
          })

        if (error) throw error

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('attachments')
          .getPublicUrl(data.path)

        const completedFile: UploadedFile = {
          ...uploadFile,
          status: 'completed',
          progress: 100,
          url: urlData.publicUrl,
        }

        // Update state
        setFiles(prev => prev.map(f => 
          f.id === uploadFile.id ? completedFile : f
        ))

        onUploadComplete?.(completedFile)
        return completedFile

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Upload failed'
        
        // Update status to error
        setFiles(prev => prev.map(f => 
          f.id === uploadFile.id ? { ...f, status: 'error' as const, error: errorMessage } : f
        ))

        onError?.(`Failed to upload ${uploadFile.name}: ${errorMessage}`)
        return { ...uploadFile, status: 'error' as const, error: errorMessage }
      }
    })

    await Promise.all(uploadPromises)
    
    // Return all completed files
    return files.filter(f => f.status === 'completed')
  }, [files, user, onError, onUploadComplete])

  const getCompletedFiles = useCallback(() => {
    return files.filter(f => f.status === 'completed')
  }, [files])

  return {
    files,
    isUploading,
    addFiles,
    removeFile,
    clearFiles,
    uploadFiles,
    getCompletedFiles,
  }
}
