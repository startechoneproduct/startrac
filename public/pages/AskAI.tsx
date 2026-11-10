import { useState } from "react";
import { History, SquarePen } from "lucide-react";
import { AiChat, type Turn } from "@/components/ai/AiChat";
import { ChatHistory, type OpenedChat } from "@/components/ai/ChatHistory";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/EmptyState";
import { useSession } from "@/lib/session";
import { suggestionsFor } from "@/lib/aiPrompts";

type Session = { id?: string; module: string; turns: Turn[] };
const FRESH: Session = { module: "ask-ai", turns: [] };

/**
 * The whole-business conversation, with every past chat alongside it. Same
 * engine as the assistant in the top bar (components/ai/AiChat.tsx) — answers
 * grounded in this business's own numbers and its trade's logic, with any
 * action it proposes waiting for your approval first. Conversations are saved
 * on the server as they happen (see server/modules/ai/ai.routes.js).
 */
export function AskAI() {
  const { activeBusiness } = useSession();
  const [chat, setChat] = useState<Session>(FRESH);
  const [version, setVersion] = useState(0);
  const [showHistory, setShowHistory] = useState(false); // phones: history replaces the chat

  const newChat = () => { setChat({ ...FRESH }); setShowHistory(false); };
  const openFromHistory = (c: OpenedChat) => { setChat({ id: c.id, module: c.module, turns: c.turns }); setShowHistory(false); };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1120px] mx-auto flex flex-col h-full">
      <PageHeader
        title="Ask AI"
        subtitle="Answers grounded in this business's own numbers and how its trade works — actions always wait for your approval"
        actions={
          <div className="flex items-center gap-2 lg:hidden">
            <Button variant="secondary" onClick={() => setShowHistory((v) => !v)}><History className="w-4 h-4" /> History</Button>
            <Button variant="secondary" onClick={newChat}><SquarePen className="w-4 h-4" /> New</Button>
          </div>
        }
      />
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-5">
        <div className={`${showHistory ? "block" : "hidden"} lg:block min-h-0 rounded-[24px] border border-line overflow-hidden shadow-e1`}>
          <ChatHistory
            activeId={chat.id}
            version={version}
            onOpen={openFromHistory}
            onNew={newChat}
            onDeleted={(id) => { if (id === "all" || id === chat.id) newChat(); }}
          />
        </div>
        <div className={`${showHistory ? "hidden" : "block"} lg:block min-h-0 rounded-[24px] border border-line bg-canvas shadow-e1 overflow-hidden`}>
          <AiChat
            key={chat.id ?? "new"}
            compact
            module={chat.module}
            turns={chat.turns}
            onTurns={(fn) => setChat((s) => ({ ...s, turns: fn(s.turns) }))}
            chatId={chat.id}
            onSaved={(id) => { setChat((s) => ({ ...s, id })); setVersion((v) => v + 1); }}
            suggestions={suggestionsFor(chat.module, activeBusiness?.typeKey)}
            title="Ask about your whole business"
          />
        </div>
      </div>
    </div>
  );
}
