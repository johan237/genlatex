import Navigation from '@/components/layout/Navigation';
import Footer from '@/components/layout/Footer';
export const metadata = { title: 'Privacy' };
export default function Privacy() {
  return <><Navigation /><main className="max-w-3xl mx-auto px-6 py-20 space-y-7 text-secondary leading-relaxed"><h1 className="text-4xl font-heading text-foreground">Privacy in GenLaTeX</h1>
    <p>The static editor saves project text in this browser’s local storage. Clearing site data removes those projects. Download backups to keep a separate copy. This storage is not encrypted by the application.</p>
    <p>AI assistance is optional. When you click Ask AI, the current file and your prompt are sent to the endpoint you configure. That provider’s privacy policy and usage charges apply. API keys are held in memory in the current tab and cleared when the page reloads.</p>
    <p>Optional browser PDF compilation runs in a Web Worker. Its engine can request TeX packages and fonts from its configured package mirror. The site host receives ordinary web requests and may retain access logs. Bibliography tools contact metadata services when you use them.</p>
    <p>Some document conversion and research tools require the optional server workspace. If a host configures that service, files submitted to those tools are sent to it and may be processed by its configured providers. Self-hosted deployments may have different settings.</p>
  </main><Footer /></>;
}
