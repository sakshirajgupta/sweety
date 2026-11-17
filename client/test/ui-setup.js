import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
Element.prototype.scrollIntoView = vi.fn();
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
