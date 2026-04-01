import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import ExportOptions from './components/ExportOptions';
import { COLUMNS_SIMPLE, COLUMNS_COMPLET } from './columns';

export type ProcessingMode = 'rapide' | 'precis';

export interface FileInfo {
  path: string;
  name: string;
  lines: number;
}

export default function App() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [totalLines, setTotalLines] = useState(0);
  const [mode, setMode] = useState<ProcessingMode>('rapide');
  const [columns, setColumns] = useState<string[]>(COLUMNS_SIMPLE);
  const [showExport, setShowExport] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const dropRef = useRef<HTMLDivElement>(null);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files).filter(f =>
      f.name.toLowerCase().endsWith('.pdf')
    );
    const newFiles: FileInfo[] = dropped.map(f => ({
      path: (f as any).path || f.name,
      name: f.name,
      lines: 1,
    }));
    setFiles(prev => {
      const all = [...prev, ...newFiles];
      setTotalLines(all.reduce((s, f) => s + f.lines, 0));
      return all;
    });
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const removeFile = (idx: number) => {
    setFiles(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      setTotalLines(updated.reduce((s, f) => s + f.lines, 0));
      return updated;
    });
  };

  const handleStart = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setProgress(0);
    setStatus('Traitement en cours...');
    try {
      const paths = files.map(f => f.path);
      const result = await invoke<string>('process_files', {
        paths,
        mode,
        columns,
      });
      setStatus(result);
      setProgress(100);
    } catch (err: any) {
      setStatus('Erreur: ' + err);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1>Rapport Amiante</h1>
        <span className="subtitle">Traitement de rapports PDF</span>
      </header>

      <div className="app-body">
        {/* Left panel */}
        <div className="left-panel">
          {/* Drop zone */}
          <div
            ref={dropRef}
            className={`drop-zone ${files.length > 0 ? 'has-files' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            {files.length === 0 ? (
              <div className="drop-hint">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p>Glisser-d&eacute;poser des fichiers PDF ici</p>
                <p className="hint-sub">Plusieurs fichiers accept&eacute;s</p>
              </div>
            ) : (
              <div className="file-list">
                {files.map((f, i) => (
                  <div key={i} className="file-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="file-name">{f.name}</span>
                    <button className="remove-btn" onClick={() => removeFile(i)}>x</button>
                  </div>
                ))}
                <div
                  className="add-more"
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                >
                  + Ajouter d'autres fichiers PDF
                </div>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="stats-bar">
            <span><strong>{files.length}</strong> fichier{files.length !== 1 ? 's' : ''}</span>
            <span className="sep">|</span>
            <span><strong>{totalLines}</strong> ligne{totalLines !== 1 ? 's' : ''} au total</span>
          </div>

          {/* Mode selector */}
          <div className="mode-selector">
            <button
              className={`mode-btn ${mode === 'rapide' ? 'active' : ''}`}
              onClick={() => setMode('rapide')}
            >
              Rapide
            </button>
            <button
              className={`mode-btn ${mode === 'precis' ? 'active' : ''}`}
              onClick={() => setMode('precis')}
            >
              Pr&eacute;cis
            </button>
          </div>

          {/* Status */}
          {status && (
            <div className={`status-bar ${progress === 100 ? 'success' : processing ? 'processing' : 'error'}`}>
              {processing && <div className="spinner" />}
              <span>{status}</span>
            </div>
          )}
          {processing && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: progress + '%' }} />
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="right-panel">
          <button
            className="start-btn"
            onClick={handleStart}
            disabled={processing || files.length === 0}
          >
            {processing ? 'Traitement...' : 'START'}
          </button>

          <button
            className="export-btn"
            onClick={() => setShowExport(true)}
          >
            Options d'export &rsaquo;&rsaquo;
          </button>
        </div>
      </div>

      {/* Export Options Modal */}
      {showExport && (
        <ExportOptions
          columns={columns}
          onColumnsChange={setColumns}
          onClose={() => setShowExport(false)}
          simpleColumns={COLUMNS_SIMPLE}
          completColumns={COLUMNS_COMPLET}
        />
      )}
    </div>
  );
}
