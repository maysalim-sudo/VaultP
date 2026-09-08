/**
 * Reading the text in a scan.
 *
 * ON-DEVICE, DELIBERATELY. ML Kit runs the model locally, so a photograph of a
 * passport never leaves the phone. Sending ID documents to a cloud OCR service
 * would undo the point of encrypting them here, and would mean this app quietly
 * became a way for someone else's servers to hold your papers.
 *
 * OCR runs once, at capture, against the plaintext image before it is encrypted —
 * never against the vault copy. The text lands in the database, which SQLCipher
 * encrypts, so the searchable index is protected exactly like everything else
 * rather than sitting beside the file as readable plaintext.
 */

import TextRecognition from '@react-native-ml-kit/text-recognition';

export interface RecognisedText {
  readonly text: string;
  readonly lineCount: number;
}

/**
 * @returns the text found, or undefined when there is none worth keeping.
 *
 * Failure is never fatal: a document with no searchable text is still a document.
 * A photograph of a plain object, or a blurred scan, legitimately yields nothing.
 */
export async function recogniseText(imageUri: string): Promise<RecognisedText | undefined> {
  try {
    const result = await TextRecognition.recognize(imageUri);
    const text = result.text.trim();
    if (text === '') return undefined;

    return { text, lineCount: result.blocks.length };
  } catch {
    return undefined;
  }
}

/**
 * Guess a title from the recognised text.
 *
 * A rough heuristic on purpose. It is a starting point the user is expected to
 * correct — the detail screen opens straight onto the title field — and a wrong
 * guess costs one edit, while no guess costs the same edit every time.
 */
export function suggestTitle(text: string): string | undefined {
  const known: ReadonlyArray<{ pattern: RegExp; title: string }> = [
    { pattern: /passeport|passport|جواز/i, title: 'Passport' },
    { pattern: /carte d.?identit|identity card|بطاقة التعريف/i, title: 'Identity card' },
    { pattern: /permis de conduire|driving licen[cs]e|رخصة السياقة/i, title: 'Driving licence' },
    { pattern: /assurance|insurance|تأمين/i, title: 'Insurance' },
    { pattern: /contrat|contract|عقد/i, title: 'Contract' },
    { pattern: /facture|invoice|fatura/i, title: 'Invoice' },
    { pattern: /diplome|dipl[oô]me|diploma|شهادة/i, title: 'Diploma' },
    { pattern: /bail|lease|كراء/i, title: 'Lease' },
  ];

  for (const candidate of known) {
    if (candidate.pattern.test(text)) return candidate.title;
  }

  // Otherwise the first line with enough substance to be a heading. Short lines
  // are usually a logo, a page number, or OCR noise.
  const line = text
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.length >= 6 && value.length <= 60);

  return line;
}
