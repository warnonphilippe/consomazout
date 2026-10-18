import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly danger?: boolean;
}

interface PendingConfirm extends ConfirmRequest {
  readonly resolve: (value: boolean) => void;
}

/** Demande de confirmation affichée dans une boîte de dialogue de l'application. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly pending = signal<PendingConfirm | null>(null);

  ask(request: ConfirmRequest): Promise<boolean> {
    this.pending()?.resolve(false);
    return new Promise((resolve) => this.pending.set({ ...request, resolve }));
  }

  answer(value: boolean): void {
    this.pending()?.resolve(value);
    this.pending.set(null);
  }
}
