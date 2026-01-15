import Document, { Head, Html, Main, NextScript, DocumentContext } from "next/document";

/**
 * Custom document to inject crypto.randomUUID polyfill before any JavaScript loads.
 *
 * The Saleor App SDK uses crypto.randomUUID() which is only available in secure
 * contexts (HTTPS or localhost). For HTTP staging environments, we polyfill it
 * using crypto.getRandomValues() which works in non-secure contexts.
 *
 * This MUST be an inline script in <Head> to run before any Next.js chunks load,
 * as the polyfill in _app.tsx gets tree-shaken during the build process.
 */
class MyDocument extends Document {
  static async getInitialProps(ctx: DocumentContext) {
    const initialProps = await Document.getInitialProps(ctx);
    return initialProps;
  }

  render() {
    return (
      <Html>
        <Head>
          {/* Polyfill for crypto.randomUUID() in non-secure contexts (HTTP) */}
          <script
            dangerouslySetInnerHTML={{
              __html: `
                if (typeof crypto !== "undefined" && !crypto.randomUUID) {
                  crypto.randomUUID = function() {
                    var bytes = new Uint8Array(16);
                    crypto.getRandomValues(bytes);
                    bytes[6] = (bytes[6] & 0x0f) | 0x40;
                    bytes[8] = (bytes[8] & 0x3f) | 0x80;
                    var hex = Array.prototype.map.call(bytes, function(b) {
                      return b.toString(16).padStart(2, "0");
                    }).join("");
                    return hex.slice(0,8) + "-" + hex.slice(8,12) + "-" + hex.slice(12,16) + "-" + hex.slice(16,20) + "-" + hex.slice(20);
                  };
                }
              `,
            }}
          />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
