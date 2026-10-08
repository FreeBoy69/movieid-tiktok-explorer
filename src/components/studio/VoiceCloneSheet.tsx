// Clone a voice without leaving the page: the shared clone flow (VoiceCloneForm,
// also the Audio Studio Clone tab) inside the shared dialog.
import { Dialog } from "../ui/Dialog";
import { VoiceCloneForm } from "./VoiceCloneForm";

export function VoiceCloneSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (voiceId: string) => void }) {
  return (
    <Dialog
      title="Clone a voice"
      description="Read the passage for about 20 seconds, or upload a clean recording of one speaker. Only you can see and use voices you clone."
      size="lg"
      dismissible={false}
      onClose={onClose}
      className="as-clone-dialog"
    >
      <VoiceCloneForm heading={false} onCancel={onClose} onCreated={(id) => onCreated(id)} />
    </Dialog>
  );
}
