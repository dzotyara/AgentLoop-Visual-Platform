import { I18nProvider } from "../i18n";
import PixelIcon from "../components/pixel/PixelIcon";

interface AppLoadingScreenProps {
  language: string;
  title: string;
  subtitle: string;
}

export default function AppLoadingScreen({ language, title, subtitle }: AppLoadingScreenProps) {
  return (
    <I18nProvider language={language}>
      <div className="h-screen flex items-center justify-center" style={{ background: "var(--th-bg-primary)" }}>
        <div className="text-center">
          <div className="mb-4 flex justify-center animate-agent-bounce">
            <PixelIcon name="office" size={48} />
          </div>
          <div className="text-lg font-medium" style={{ color: "var(--th-text-secondary)" }}>
            {title}
          </div>
          <div className="text-sm mt-1" style={{ color: "var(--th-text-muted)" }}>
            {subtitle}
          </div>
        </div>
      </div>
    </I18nProvider>
  );
}
