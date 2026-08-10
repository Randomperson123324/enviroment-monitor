'use client';

/**
 * The heading for whichever section is open, with a hairline rule running the
 * full width beneath it.
 *
 * The tabs used to be the only thing naming the current section, and on a wide
 * screen the active pill in the rail is far from the content it labels. `children`
 * are controls that belong to the page rather than to a panel inside it — they sit
 * between the title and the rule, so the rule always closes the header.
 */
export default function PageTitle({ title, children }) {
  return (
    <header className="page-head">
      <div className="page-head-row">
        <h1 className="page-title">{title}</h1>
        {children}
      </div>
      <div className="page-rule" aria-hidden />
    </header>
  );
}
