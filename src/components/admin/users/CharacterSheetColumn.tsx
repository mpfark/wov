import { AdminEditorHeader } from '../common';
import AdminCharacterSheet from './AdminCharacterSheet';
import type { AdminCharacter, AdminUser, CharacterEdits } from './constants';

interface Props {
  selectedUser: AdminUser | null;
  selectedChar: AdminCharacter | null;
  editingChar: string | null;
  charEdits: CharacterEdits;
  setCharEdits: React.Dispatch<React.SetStateAction<CharacterEdits>>;
  onEdit: (charId: string) => void;
  onSave: (charId: string) => void;
  onCancel: () => void;
}

export default function CharacterSheetColumn({
  selectedUser, selectedChar, editingChar, charEdits, setCharEdits,
  onEdit, onSave, onCancel,
}: Props) {
  return (
    <div className="w-[400px] shrink-0 overflow-y-auto min-h-0 border-r border-border flex flex-col">
      {!selectedChar ? (
        <div className="flex items-center justify-center h-full text-xs text-muted-foreground italic">
          {!selectedUser ? 'Select a user' : selectedUser.characters.length === 0 ? 'No characters' : 'Select a character'}
        </div>
      ) : (
        <>
          <AdminEditorHeader
            title={`Character Sheet — ${selectedChar.name}`}
            onClose={onCancel}
          />
          <div className="p-3 space-y-3 flex-1 overflow-y-auto">
            <AdminCharacterSheet
              c={selectedChar}
              isEditing={editingChar === selectedChar.id}
              charEdits={charEdits}
              setCharEdits={setCharEdits}
              onEdit={() => onEdit(selectedChar.id)}
              onSave={() => onSave(selectedChar.id)}
              onCancel={onCancel}
            />
          </div>
        </>
      )}
    </div>
  );
}
