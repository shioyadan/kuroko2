use std::sync::Arc;

use fontdb::Database;
use krilla::geom::Size;
use krilla::page::PageSettings;
use krilla::Document;
use krilla_svg::{SurfaceExt, SvgSettings};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn engine_name() -> String {
    "krilla-svg".into()
}

#[wasm_bindgen]
pub struct SvgPdfConverter {
    fonts: Database,
}

#[wasm_bindgen]
impl SvgPdfConverter {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            fonts: Database::new(),
        }
    }

    pub fn clear_fonts(&mut self) {
        self.fonts = Database::new();
    }

    pub fn add_font(&mut self, data: &[u8]) -> usize {
        self.fonts.load_font_data(data.to_vec());
        self.fonts.len()
    }

    pub fn convert(&self, svg: &str, embed_text: bool) -> Result<Vec<u8>, JsValue> {
        let options = usvg::Options {
            fontdb: Arc::new(self.fonts.clone()),
            ..Default::default()
        };
        let tree = usvg::Tree::from_str(svg, &options)
            .map_err(|error| JsValue::from_str(&format!("SVG parse failed: {error}")))?;
        let size = Size::from_wh(tree.size().width(), tree.size().height())
            .ok_or_else(|| JsValue::from_str("SVG size must be greater than zero"))?;

        let mut document = Document::new();
        let mut page = document.start_page_with(PageSettings::new(size));
        let mut surface = page.surface();
        surface
            .draw_svg(
                &tree,
                size,
                SvgSettings {
                    embed_text,
                    ..Default::default()
                },
            )
            .ok_or_else(|| JsValue::from_str("SVG rendering failed"))?;
        surface.finish();
        page.finish();
        document
            .finish()
            .map_err(|error| JsValue::from_str(&format!("PDF serialization failed: {error:?}")))
    }
}

impl Default for SvgPdfConverter {
    fn default() -> Self {
        Self::new()
    }
}
