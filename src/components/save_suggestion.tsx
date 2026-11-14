import { useState } from "react";
import type { SavedFigure } from "../save_history";

interface Props {
    readonly candidates: readonly SavedFigure[];
    readonly currentPreview: string;
    readonly onSave: (id: string) => void;
    readonly onSaveAs: (id: string) => void;
    readonly onDismiss: () => void;
}
export function SaveSuggestion({ candidates, currentPreview, onSave, onSaveAs, onDismiss }: Props) {
    const [selected, setSelected] = useState(candidates[0].id);
    const candidate = candidates.find(record => record.id === selected) ?? candidates[0];
    return <>
        <p>This figure looks like one you saved before. Use the same PDF name?</p>
        <div className="suggestion-previews">
            <figure><img src={candidate.thumbnail} alt="Previously saved figure" /><figcaption>Previously saved</figcaption></figure>
            <figure><img src={currentPreview} alt="Current figure to save" /><figcaption>Current figure</figcaption></figure>
        </div>
        <fieldset className="candidate-list"><legend>Suggested file name</legend>
            {candidates.map(record => <label key={record.id}>
                <input type="radio" name="suggested-file" value={record.id} checked={candidate.id === record.id} onChange={() => setSelected(record.id)} />
                <span><strong>{record.name}</strong><small>Saved {new Date(record.savedAt).toLocaleString()}</small></span>
            </label>)}
        </fieldset>
        <p className="save-destination-note">{candidate.handle
            ? `This will overwrite the previously selected file “${candidate.name}”.`
            : "The browser will ask where to save, or download a new copy. An earlier download cannot be overwritten automatically."}</p>
        <div className="dialog-actions">
            <button className="primary-button" onClick={() => onSave(candidate.id)}>{candidate.handle ? "Overwrite PDF" : "Save with this name"}</button>
            <button onClick={() => onSaveAs(candidate.id)}>Save as…</button>
            <button onClick={onDismiss}>Not now</button>
        </div>
    </>;
}
