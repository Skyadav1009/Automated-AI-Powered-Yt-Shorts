import React, { useState } from 'react';
import { InputForm } from './components/InputForm';
import { ResultDisplay } from './components/ResultDisplay';
import { generateShortPackage } from './services/gemini';
import { GeneratorConfig, LoadingState, ShortPackage } from './types';
import { Zap, AlertCircle } from 'lucide-react';

const App: React.FC = () => {
  const [loadingState, setLoadingState] = useState<LoadingState>(LoadingState.IDLE);
  const [result, setResult] = useState<ShortPackage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (config: GeneratorConfig) => {
    setLoadingState(LoadingState.GENERATING);
    setError(null);
    setResult(null);

    try {
      const data = await generateShortPackage(config);
      setResult(data);
      setLoadingState(LoadingState.SUCCESS);
    } catch (err: any) {
      setLoadingState(LoadingState.ERROR);
      setError(err.message || "Failed to generate content. Please check API Key and try again.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-gray-100 font-sans selection:bg-brand-500/30">
      
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-brand-500 p-1.5 rounded-lg shadow-lg shadow-brand-500/20">
               <Zap className="w-5 h-5 text-white fill-white" />
            </div>
            <h1 className="text-lg font-bold tracking-tight">
              Viral<span className="text-brand-400">Shorts</span>.ai
            </h1>
          </div>
          <div className="text-xs font-medium text-gray-500 bg-gray-800 px-3 py-1 rounded-full border border-gray-700">
            MERN Automation Engine
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        
        <div className="mb-8 text-center">
           <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-3">
             Generate High-Retention Shorts
           </h1>
           <p className="text-gray-400 text-lg max-w-2xl mx-auto">
             Create complete viral video packages including scripts, metadata, and visual direction in seconds.
           </p>
        </div>

        <InputForm onGenerate={handleGenerate} loadingState={loadingState} />

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-8 flex items-start gap-3 text-red-400">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-sm">Generation Failed</h3>
              <p className="text-sm opacity-90">{error}</p>
            </div>
          </div>
        )}

        {result && <ResultDisplay data={result} />}
      </main>

    </div>
  );
};

export default App;