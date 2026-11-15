import { useEffect, useRef, type ReactNode } from "react";
import { BsList } from "react-icons/bs";

// Match Konata's native disclosure menu: Enter/Space opens it and Tab visits
// the actions. Keep file-picker actions in the original click's call stack.
export function ApplicationMenu({ children }: { children: ReactNode }) {
    const menu = useRef<HTMLDetailsElement>(null);
    const trigger = useRef<HTMLElement>(null);
    useEffect(() => {
        const closeOutside = (event: Event) => {
            if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false;
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || !menu.current?.open) return;
            event.preventDefault(); event.stopPropagation();
            menu.current.open = false;
            trigger.current?.focus();
        };
        document.addEventListener("pointerdown", closeOutside);
        document.addEventListener("focusin", closeOutside);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("pointerdown", closeOutside);
            document.removeEventListener("focusin", closeOutside);
            document.removeEventListener("keydown", escape);
        };
    }, []);
    return <details ref={menu} className="application-menu">
        <summary ref={trigger} aria-label="Application menu" title="Menu"><BsList aria-hidden="true" /></summary>
        <div className="application-menu-panel" onClickCapture={event => {
            const button = event.target instanceof Element ? event.target.closest("button") : null;
            if (button && !button.disabled && menu.current) {
                menu.current.open = false;
                trigger.current?.focus();
            }
        }}>{children}</div>
    </details>;
}
