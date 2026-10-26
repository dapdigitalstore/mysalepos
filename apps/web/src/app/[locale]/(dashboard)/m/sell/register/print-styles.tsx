/**
 * Print only the register summary: the sidebar and header belong to the app shell, so everything else is hidden
 * when printing and the element with id `register-print-area` is moved to the top of the page.
 */
export function PrintStyles() {
  return (
    <style>{`
      @media print {
        body * { visibility: hidden; }
        #register-print-area, #register-print-area * { visibility: visible; }
        #register-print-area { position: absolute; inset-inline: 0; top: 0; width: 100%; box-shadow: none; }
      }
    `}</style>
  );
}
