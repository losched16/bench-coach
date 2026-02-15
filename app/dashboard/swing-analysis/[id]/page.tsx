import SwingAnalysisView from '@/components/SwingAnalysisView'

export default function SwingAnalysisPage({ 
  params 
}: { 
  params: { id: string } 
}) {
  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <SwingAnalysisView analysisId={params.id} />
    </div>
  )
}