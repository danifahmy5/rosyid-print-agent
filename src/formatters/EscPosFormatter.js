/**
 * ESC/POS Formatter
 * 
 * Utilities for generating ESC/POS receipt commands.
 * Supports text formatting, barcodes, QR codes, and paper cutting.
 */

class EscPosFormatter {
  constructor() {
    // ESC/POS Command Constants
    this.commands = {
      // Initialize
      INIT: Buffer.from([0x1B, 0x40]),
      
      // Text alignment
      ALIGN_LEFT: Buffer.from([0x1B, 0x61, 0x00]),
      ALIGN_CENTER: Buffer.from([0x1B, 0x61, 0x01]),
      ALIGN_RIGHT: Buffer.from([0x1B, 0x61, 0x02]),
      
      // Font size
      SIZE_NORMAL: Buffer.from([0x1D, 0x21, 0x00]),
      SIZE_DOUBLE_HEIGHT: Buffer.from([0x1D, 0x21, 0x01]),
      SIZE_DOUBLE_WIDTH: Buffer.from([0x1D, 0x21, 0x10]),
      SIZE_DOUBLE: Buffer.from([0x1D, 0x21, 0x11]),
      
      // Font style
      BOLD_ON: Buffer.from([0x1B, 0x45, 0x01]),
      BOLD_OFF: Buffer.from([0x1B, 0x45, 0x00]),
      UNDERLINE_ON: Buffer.from([0x1B, 0x2D, 0x01]),
      UNDERLINE_OFF: Buffer.from([0x1B, 0x2D, 0x00]),
      
      // Paper
      FEED_LINE: Buffer.from([0x0A]),
      FEED_LINES: (n) => Buffer.from([0x1B, 0x64, n]),
      CUT_PARTIAL: Buffer.from([0x1D, 0x56, 0x01]),
      CUT_FULL: Buffer.from([0x1D, 0x56, 0x00]),
      
      // Cash drawer
      OPEN_DRAWER: Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]),
      
      // Horizontal line helper
      HR: (charWidth = 48) => Buffer.from('-'.repeat(charWidth) + '\n'),
      HR_DOUBLE: (charWidth = 48) => Buffer.from('='.repeat(charWidth) + '\n')
    };
  }

  /**
   * Create a new receipt builder
   */
  createReceipt() {
    return new ReceiptBuilder(this);
  }

  /**
   * Create a kitchen ticket
   */
  createKitchenTicket() {
    return new KitchenTicketBuilder(this);
  }

  /**
   * Format currency
   */
  formatCurrency(amount, symbol = 'Rp') {
    return `${symbol} ${amount.toLocaleString('id-ID')}`;
  }

  /**
   * Format date/time
   */
  formatDateTime(date = new Date()) {
    return date.toLocaleString('id-ID', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * Create two-column line (left and right aligned)
   */
  twoColumnLine(left, right, width = 48) {
    const spaces = width - left.length - right.length;
    if (spaces < 1) {
      return left + ' ' + right + '\n';
    }
    return left + ' '.repeat(spaces) + right + '\n';
  }

  /**
   * Generate QR code command
   * @param {string} data - Data to encode
   * @param {number} size - Module size (1-16)
   */
  qrCode(data, size = 4) {
    const bytes = [];
    
    // QR Code: Select model
    bytes.push(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    
    // QR Code: Set size
    bytes.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, size);
    
    // QR Code: Set error correction level
    bytes.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31);
    
    // QR Code: Store data
    const dataBuffer = Buffer.from(data);
    const storeLen = dataBuffer.length + 3;
    const pL = storeLen % 256;
    const pH = Math.floor(storeLen / 256);
    bytes.push(0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30);
    
    const buffer = Buffer.concat([
      Buffer.from(bytes),
      dataBuffer,
      Buffer.from([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]) // Print QR
    ]);
    
    return buffer;
  }

  /**
   * Generate barcode command (Code 128)
   * @param {string} data - Barcode data
   * @param {number} height - Barcode height (25-255)
   */
  barcode(data, height = 80) {
    const bytes = [
      0x1D, 0x68, height,     // Set height
      0x1D, 0x77, 0x02,       // Set width
      0x1D, 0x48, 0x02,       // HRI below barcode
      0x1D, 0x6B, 0x49,       // Code 128
      data.length + 2         // Length
    ];
    
    bytes.push(0x7B, 0x42); // Code128 subset B
    
    for (const char of data) {
      bytes.push(char.charCodeAt(0));
    }
    
    return Buffer.from(bytes);
  }
}

/**
 * Receipt Builder for POS receipts
 */
class ReceiptBuilder {
  constructor(formatter) {
    this.formatter = formatter;
    this.cmd = formatter.commands;
    this.buffers = [];
    this.charWidth = 48;
    
    // Initialize printer
    this.buffers.push(this.cmd.INIT);
  }

  /**
   * Set character width (depends on printer)
   */
  setCharWidth(width) {
    this.charWidth = width;
    return this;
  }

  /**
   * Add header
   */
  header(storeName, tagline = '') {
    this.buffers.push(
      this.cmd.ALIGN_CENTER,
      this.cmd.SIZE_DOUBLE,
      Buffer.from(storeName + '\n'),
      this.cmd.SIZE_NORMAL
    );
    
    if (tagline) {
      this.buffers.push(Buffer.from(tagline + '\n'));
    }
    
    this.buffers.push(this.cmd.ALIGN_LEFT);
    return this;
  }

  /**
   * Add horizontal line
   */
  hr(double = false) {
    if (double) {
      this.buffers.push(this.cmd.HR_DOUBLE(this.charWidth));
    } else {
      this.buffers.push(this.cmd.HR(this.charWidth));
    }
    return this;
  }

  /**
   * Add text line
   */
  text(text, align = 'left') {
    if (align === 'center') this.buffers.push(this.cmd.ALIGN_CENTER);
    else if (align === 'right') this.buffers.push(this.cmd.ALIGN_RIGHT);
    
    this.buffers.push(Buffer.from(text + '\n'));
    this.buffers.push(this.cmd.ALIGN_LEFT);
    return this;
  }

  /**
   * Add bold text
   */
  bold(text) {
    this.buffers.push(
      this.cmd.BOLD_ON,
      Buffer.from(text + '\n'),
      this.cmd.BOLD_OFF
    );
    return this;
  }

  /**
   * Add large text
   */
  large(text, align = 'center') {
    if (align === 'center') this.buffers.push(this.cmd.ALIGN_CENTER);
    
    this.buffers.push(
      this.cmd.SIZE_DOUBLE,
      Buffer.from(text + '\n'),
      this.cmd.SIZE_NORMAL,
      this.cmd.ALIGN_LEFT
    );
    return this;
  }

  /**
   * Add two-column line
   */
  row(left, right) {
    this.buffers.push(
      Buffer.from(this.formatter.twoColumnLine(left, right, this.charWidth))
    );
    return this;
  }

  /**
   * Add item line with quantity and price
   */
  item(name, qty, price, subtotal) {
    const qtyStr = `${qty}x`;
    const priceStr = this.formatter.formatCurrency(price);
    const subtotalStr = this.formatter.formatCurrency(subtotal);
    
    // Item name on first line
    this.buffers.push(Buffer.from(`${name}\n`));
    
    // Qty, price, subtotal on second line
    const detail = `  ${qtyStr} @ ${priceStr}`;
    this.buffers.push(
      Buffer.from(this.formatter.twoColumnLine(detail, subtotalStr, this.charWidth))
    );
    
    return this;
  }

  /**
   * Add total line
   */
  total(label, amount) {
    this.buffers.push(
      this.cmd.BOLD_ON,
      this.cmd.SIZE_DOUBLE_HEIGHT,
      Buffer.from(this.formatter.twoColumnLine(label, this.formatter.formatCurrency(amount), this.charWidth)),
      this.cmd.SIZE_NORMAL,
      this.cmd.BOLD_OFF
    );
    return this;
  }

  /**
   * Add QR code
   */
  qr(data, size = 4) {
    this.buffers.push(
      this.cmd.ALIGN_CENTER,
      this.formatter.qrCode(data, size),
      Buffer.from('\n'),
      this.cmd.ALIGN_LEFT
    );
    return this;
  }

  /**
   * Add barcode
   */
  barcode(data, height = 80) {
    this.buffers.push(
      this.cmd.ALIGN_CENTER,
      this.formatter.barcode(data, height),
      Buffer.from('\n\n'),
      this.cmd.ALIGN_LEFT
    );
    return this;
  }

  /**
   * Add empty lines
   */
  feed(lines = 1) {
    this.buffers.push(this.cmd.FEED_LINES(lines));
    return this;
  }

  /**
   * Add cut command
   */
  cut(partial = true) {
    this.buffers.push(
      this.cmd.FEED_LINES(3),
      partial ? this.cmd.CUT_PARTIAL : this.cmd.CUT_FULL
    );
    return this;
  }

  /**
   * Open cash drawer
   */
  openDrawer() {
    this.buffers.push(this.cmd.OPEN_DRAWER);
    return this;
  }

  /**
   * Build final buffer
   */
  build() {
    return Buffer.concat(this.buffers);
  }
}

/**
 * Kitchen Ticket Builder
 */
class KitchenTicketBuilder {
  constructor(formatter) {
    this.formatter = formatter;
    this.cmd = formatter.commands;
    this.buffers = [];
    this.charWidth = 48;
    
    this.buffers.push(this.cmd.INIT);
  }

  setCharWidth(width) {
    this.charWidth = width;
    return this;
  }

  /**
   * Add order header
   */
  orderHeader(orderNumber, tableNumber = null, time = new Date()) {
    this.buffers.push(
      this.cmd.ALIGN_CENTER,
      this.cmd.SIZE_DOUBLE,
      Buffer.from(`ORDER #${orderNumber}\n`),
      this.cmd.SIZE_NORMAL
    );

    if (tableNumber) {
      this.buffers.push(
        this.cmd.SIZE_DOUBLE,
        Buffer.from(`TABLE ${tableNumber}\n`),
        this.cmd.SIZE_NORMAL
      );
    }

    this.buffers.push(
      Buffer.from(this.formatter.formatDateTime(time) + '\n'),
      this.cmd.ALIGN_LEFT,
      this.cmd.HR(this.charWidth)
    );

    return this;
  }

  /**
   * Add item (large font for kitchen)
   */
  item(qty, name, notes = '') {
    this.buffers.push(
      this.cmd.SIZE_DOUBLE,
      Buffer.from(`${qty}x ${name}\n`),
      this.cmd.SIZE_NORMAL
    );

    if (notes) {
      this.buffers.push(
        this.cmd.BOLD_ON,
        Buffer.from(`   >> ${notes}\n`),
        this.cmd.BOLD_OFF
      );
    }

    return this;
  }

  /**
   * Add category separator
   */
  category(name) {
    this.buffers.push(
      this.cmd.HR(this.charWidth),
      this.cmd.ALIGN_CENTER,
      this.cmd.BOLD_ON,
      Buffer.from(`[ ${name.toUpperCase()} ]\n`),
      this.cmd.BOLD_OFF,
      this.cmd.ALIGN_LEFT,
      this.cmd.HR(this.charWidth)
    );
    return this;
  }

  /**
   * Add notes
   */
  notes(text) {
    this.buffers.push(
      this.cmd.HR(this.charWidth),
      this.cmd.BOLD_ON,
      Buffer.from(`NOTES: ${text}\n`),
      this.cmd.BOLD_OFF
    );
    return this;
  }

  feed(lines = 1) {
    this.buffers.push(this.cmd.FEED_LINES(lines));
    return this;
  }

  cut(partial = true) {
    this.buffers.push(
      this.cmd.FEED_LINES(3),
      partial ? this.cmd.CUT_PARTIAL : this.cmd.CUT_FULL
    );
    return this;
  }

  build() {
    return Buffer.concat(this.buffers);
  }
}

module.exports = { EscPosFormatter };
