// File System Access API (Chrome/Edge) の型補完
// lib.dom.d.ts に showDirectoryPicker が含まれていないため宣言する

interface Window {
  showDirectoryPicker(options?: {
    mode?: 'read' | 'readwrite'
    startIn?: string
  }): Promise<FileSystemDirectoryHandle>
  showSaveFilePicker(options?: {
    suggestedName?: string
    types?: Array<{
      description?: string
      accept: Record<string, string[]>
    }>
  }): Promise<FileSystemFileHandle>
}
