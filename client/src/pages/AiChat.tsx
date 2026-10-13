import { useMobileRedesign } from "@/hooks/useMobileUi";
import { AiChatView } from "@/components/aiChat/AiChatView";
import { useAiChat } from "@/components/aiChat/useAiChat";
import AiChatMobile from "@/pages/redesign/AiChatMobile";

function AiChatClassic() {
  const c = useAiChat();
  return (
    <div className="p-4 md:p-6" data-testid="page-ai-chat">
      <AiChatView c={c} variant="desktop" />
    </div>
  );
}

export default function AiChat() {
  const redesign = useMobileRedesign();
  return redesign ? <AiChatMobile /> : <AiChatClassic />;
}
