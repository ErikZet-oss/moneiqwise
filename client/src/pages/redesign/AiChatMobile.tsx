import { AiChatView } from "@/components/aiChat/AiChatView";
import { useAiChat } from "@/components/aiChat/useAiChat";

export default function AiChatMobile() {
  const c = useAiChat();
  return (
    <div data-testid="page-ai-chat-mobile">
      <AiChatView c={c} variant="mobile" />
    </div>
  );
}
