import { UploadedFile, getFileCategory, formatFileSize } from '../../hooks/useFileUpload'

interface AttachmentPreviewProps {
  files: UploadedFile[]
  onRemove: (id: string) => void
}

// File type icons
function FileIcon({ type }: { type: 'document' | 'audio' | 'unknown' }) {
  if (type === 'document') {
    return (
      <svg className="w-6 h-6 text-red-500" fill="currentColor" viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v6h6v10H6z"/>
        <path d="M8 12h8v2H8zm0 4h8v2H8z"/>
      </svg>
    )
  }
  if (type === 'audio') {
    return (
      <svg className="w-6 h-6 text-purple-500" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
      </svg>
    )
  }
  return (
    <svg className="w-6 h-6 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h6v6h6v10H6z"/>
    </svg>
  )
}

// Remove button
function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute -top-2 -right-2 w-6 h-6 bg-gray-800 hover:bg-gray-700 text-white rounded-full flex items-center justify-center shadow-md transition-colors"
      aria-label="Remove file"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  )
}

// Loading spinner
function Spinner() {
  return (
    <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg">
      <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Single attachment preview
function AttachmentItem({ file, onRemove }: { file: UploadedFile; onRemove: () => void }) {
  const category = getFileCategory(file.file)
  const isUploading = file.status === 'uploading'
  const hasError = file.status === 'error'

  // Image preview
  if (category === 'image' && file.previewUrl) {
    return (
      <div className="relative group flex-shrink-0">
        <div className={`w-16 h-16 rounded-lg overflow-hidden border-2 ${
          hasError ? 'border-red-400' : 'border-transparent'
        }`}>
          <img
            src={file.previewUrl}
            alt={file.name}
            className="w-full h-full object-cover"
          />
          {isUploading && <Spinner />}
        </div>
        <RemoveButton onClick={onRemove} />
        {hasError && (
          <div className="absolute -bottom-1 left-0 right-0 text-center">
            <span className="text-[10px] text-red-500 bg-white px-1 rounded">Error</span>
          </div>
        )}
      </div>
    )
  }

  // Non-image file preview (document, audio, etc.)
  return (
    <div className="relative group flex-shrink-0">
      <div className={`h-16 px-3 rounded-lg border-2 ${
        hasError ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-gray-50'
      } flex items-center gap-2 min-w-[120px] max-w-[180px]`}>
        <FileIcon type={category === 'image' ? 'unknown' : category} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-700 truncate" title={file.name}>
            {file.name}
          </p>
          <p className="text-[10px] text-gray-500">
            {formatFileSize(file.size)}
          </p>
        </div>
        {isUploading && (
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        )}
      </div>
      <RemoveButton onClick={onRemove} />
    </div>
  )
}

export default function AttachmentPreview({ files, onRemove }: AttachmentPreviewProps) {
  if (files.length === 0) return null

  return (
    <div className="px-2 py-2 border-b border-gray-100">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {files.map(file => (
          <AttachmentItem
            key={file.id}
            file={file}
            onRemove={() => onRemove(file.id)}
          />
        ))}
      </div>
    </div>
  )
}
