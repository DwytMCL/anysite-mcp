// Pack callbacks in sites/ are passed to page.evaluate and run in the page, where document exists. Declared loosely
// rather than with the DOM lib, whose fetch and friends would clash with @types/node. Type checking only: not shipped.
declare const document: any;
