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
    const needsPermission = state.fontAccess === "permission" || state.fontAccess === "unknown";
    const folderChoice = <>
        <p>Choose a folder containing the missing fonts. Matching files in its subfolders are loaded automatically.</p>
        <p className="help-text">For Office fonts such as Aptos, select the <code>CloudFonts</code> folder under <code>%LOCALAPPDATA%\Microsoft\FontCache</code>. Other installed fonts are usually in <code>C:\Windows\Fonts</code>.</p>
        <button className="primary-button" disabled={state.busy || state.saving} onClick={onChooseFolder}>Choose font folder…</button>
        <details className="font-file-option">
            <summary>Choose individual font files instead</summary>
            <p className="help-text">Select TTF, OTF, TTC or OTC files containing the fonts listed above.</p>
            <button disabled={state.busy || state.saving} onClick={onChooseFiles}>Choose font files…</button>
        </details>
    </>;
    return <>
        <p>Fonts are loaded automatically when you paste a figure. Only fonts that could not be loaded need to be added here.</p>
        {!state.document ? <p>Paste a figure to see which fonts it needs.</p>
            : required.length === 0 ? <p>This figure does not need any text fonts.</p>
            : <>
                <h3>Fonts for this figure</h3>
                <ul className="font-list">{required.map(font => <li key={fontKey(font)}>
                    <span>{fontLabel(font)}</span>
                    <span className={missing.has(fontKey(font)) ? "font-missing" : "font-ready"}>{state.busy ? "Checking…" : missing.has(fontKey(font)) ? "Missing" : "Ready"}</span>
                </li>)}</ul>
                {state.busy ? <p role="status">{state.status}</p> : missing.size > 0 ? <div className="font-setup-step">
                    {needsPermission ? <>
                        <p>Allow access to the fonts on this computer. kuroko 2 will find the fonts needed by your figure.</p>
                        <button className="primary-button" disabled={state.saving} onClick={onAllow}>Allow font access</button>
                        <details className="font-file-option"><summary>Add fonts from a folder or files instead</summary>{folderChoice}</details>
                    </> : <>
                        {state.fontAccess === "denied" && <p>Font access is blocked in your browser. You can allow it in the site settings or select the fonts below.</p>}
                        {state.fontAccess === "unsupported" && <p>This browser cannot load installed fonts automatically. Select the fonts below.</p>}
                        {state.fontAccess === "failed" && <p>Automatic font loading did not succeed. Select the fonts below to continue.</p>}
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
