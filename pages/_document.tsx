import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html>
      <Head />
      <body>
        <div id="__next" suppressHydrationWarning>
          <Main />
        </div>
        <NextScript />
      </body>
    </Html>
  )
} 