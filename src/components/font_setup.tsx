import { fontKey, fontLabel } from "../core/svg";
import type { StoreSnapshot } from "../store";

interface Props {
    readonly state: StoreSnapshot;
    readonly onAllow: () => void;
    readonly onChooseFolder: () => void;
    readonly onChooseFiles: () => void;
}

export function FontSetup({ state, onAllow, onChooseFolder, onChooseFiles }: Props) {
    const required = state.document?.fonts ?? [];
    const missing = new Set(state.missingFonts.map(fontKey));
    const synthesized = new Set(state.syntheticBoldFonts.map(fontKey));
    const needsPermission = state.fontAccess === "permission" || state.fontAccess === "unknown";
    const folderChoice = <>
        <p>Choose a folder containing the missing fonts. Matching files in its subfolders are loaded automatically.</p>
        <p className="help-text">For Office fonts such as Aptos, select the <code>CloudFonts</code> folder under <code>C:\Users\&lt;username&gt;\AppData\Local\Microsoft\FontCache</code>. Replace <code>&lt;username&gt;</code> with your Windows user folder name. Other installed fonts are usually in <code>C:\Windows\Fonts</code>.</p>
        <button className="primary-button" disabled={state.busy || state.saving} onClick={onChooseFolder}>Choose font folder…</button>
        <details className="font-file-option">
            <summary>Choose individual font files instead</summary>
            <p className="help-text">Select TTF, OTF, TTC or OTC files containing the fonts listed above.</p>
            <button disabled={state.busy || state.saving} onClick={onChooseFiles}>Choose font files…</button>
        </details>
    </>;
    return <>
        <p>Fonts are loaded automatically when you paste a figure. You can add missing fonts here to restore their original appearance.</p>
        {!state.document ? <p>Paste a figure to see which fonts it needs.</p>
            : required.length === 0 ? <p>This figure does not need any text fonts.</p>
            : <>
                <h3>Fonts for this figure</h3>
                <ul className="font-list">{required.map(font => <li key={fontKey(font)}>
                    <span>{fontLabel(font)}</span>
                    <span className={missing.has(fontKey(font)) ? "font-missing" : "font-ready"}>{state.busy ? "Checking…" : missing.has(fontKey(font)) ? "Missing" : synthesized.has(fontKey(font)) ? "Synthesized bold" : "Ready"}</span>
                </li>)}</ul>
                {synthesized.size > 0 && <p className="help-text">Cambria Math has no separate bold face. Its regular face is thickened to approximate Windows bold rendering.</p>}
                {state.busy ? <p role="status">{state.status}</p> : missing.size > 0 ? <div className="font-setup-step">
                    <p className="font-missing">{state.pdf
                        ? "The PDF uses substitute fonts and may look different. Adding the missing fonts regenerates it with the original fonts."
                        : "Allow font access or add fonts to create the PDF."}</p>
                    {needsPermission ? <>
                        <p>Allow access to the fonts on this computer. kuroko 2 will find the fonts needed by your figure.</p>
                        <button className="primary-button" disabled={state.saving} onClick={onAllow}>Allow font access</button>
                        <details className="font-file-option"><summary>Add fonts from a folder or files instead</summary>{folderChoice}</details>
                    </> : <>
                        {state.fontAccess === "denied" && <p>Font access is blocked in your browser. You can allow it in the site settings or select the fonts below.</p>}
                        {state.fontAccess === "unsupported" && <p>This browser cannot load installed fonts automatically. Select the fonts below.</p>}
                        {state.fontAccess === "failed" && <p>Automatic font loading did not succeed. You can select the original fonts below.</p>}
                        {folderChoice}
                    </>}
                </div> : <p>All fonts for this figure are ready.</p>}
            </>}
        {state.loadedFonts.length > 0 && <details className="font-file-option">
            <summary>Loaded fonts ({state.loadedFonts.length})</summary><p>{state.loadedFonts.join(", ")}</p>
        </details>}
        <p className="help-text">Font files stay on this device and are not uploaded. Selected files and folders are kept for this session.</p>
    </>;
}
