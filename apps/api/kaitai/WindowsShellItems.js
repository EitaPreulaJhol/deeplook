// This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['exports', 'kaitai-struct/KaitaiStream'], factory);
  } else if (typeof exports === 'object' && exports !== null && typeof exports.nodeType !== 'number') {
    factory(exports, require('kaitai-struct/KaitaiStream'));
  } else {
    factory(root.WindowsShellItems || (root.WindowsShellItems = {}), root.KaitaiStream);
  }
})(typeof self !== 'undefined' ? self : this, function (WindowsShellItems_, KaitaiStream) {
/**
 * Windows Shell Items (AKA "shellbags") is an undocumented set of
 * structures used internally within Windows to identify paths in
 * Windows Folder Hierarchy. It is widely used in Windows Shell (and
 * most visible in File Explorer), both as in-memory and in-file
 * structures. Some formats embed them, namely:
 * 
 * * Windows Shell link files (.lnk) Windows registry
 * * Windows registry "ShellBags" keys
 * 
 * The format is mostly undocumented, and is known to vary between
 * various Windows versions.
 * @see {@link https://github.com/libyal/libfwsi/blob/main/documentation/Windows%20Shell%20Item%20format.asciidoc|Source}
 */

var WindowsShellItems = (function() {
  function WindowsShellItems(_io, _parent, _root) {
    this._io = _io;
    this._parent = _parent;
    this._root = _root || this;
    this._debug = {};

  }
  WindowsShellItems.prototype._read = function() {
    this._debug.items = { start: this._io.pos, ioOffset: this._io.byteOffset };
    this._debug.items.arr = [];
    this.items = [];
    var i = 0;
    do {
      this._debug.items.arr[this.items.length] = { start: this._io.pos, ioOffset: this._io.byteOffset };
      var _t_items = new ShellItem(this._io, this, this._root);
      try {
        _t_items._read();
      } finally {
        var _ = _t_items;
        this.items.push(_);
      }
      this._debug.items.arr[this.items.length - 1].end = this._io.pos;
      i++;
    } while (!(_.lenData == 0));
    this._debug.items.end = this._io.pos;
  }

  /**
   * @see {@link https://github.com/libyal/libfwsi/blob/main/documentation/Windows%20Shell%20Item%20format.asciidoc#34-file-entry-shell-item|Source}
   */

  var FileEntryBody = WindowsShellItems.FileEntryBody = (function() {
    function FileEntryBody(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    FileEntryBody.prototype._read = function() {
      this._debug._unnamed0 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this._unnamed0 = this._io.readU1();
      this._debug._unnamed0.end = this._io.pos;
      this._debug.fileSize = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.fileSize = this._io.readU4le();
      this._debug.fileSize.end = this._io.pos;
      this._debug.lastModTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lastModTime = this._io.readU4le();
      this._debug.lastModTime.end = this._io.pos;
      this._debug.fileAttrs = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.fileAttrs = this._io.readU2le();
      this._debug.fileAttrs.end = this._io.pos;
    }
    Object.defineProperty(FileEntryBody.prototype, 'isDir', {
      get: function() {
        if (this._m_isDir !== undefined)
          return this._m_isDir;
        this._debug._m_isDir = {  };
        this._m_isDir = (this._parent.code & 1) != 0;
        return this._m_isDir;
      }
    });
    Object.defineProperty(FileEntryBody.prototype, 'isFile', {
      get: function() {
        if (this._m_isFile !== undefined)
          return this._m_isFile;
        this._debug._m_isFile = {  };
        this._m_isFile = (this._parent.code & 2) != 0;
        return this._m_isFile;
      }
    });

    return FileEntryBody;
  })();

  /**
   * @see {@link https://github.com/libyal/libfwsi/blob/main/documentation/Windows%20Shell%20Item%20format.asciidoc#32-root-folder-shell-item|Source}
   */

  var RootFolderBody = WindowsShellItems.RootFolderBody = (function() {
    function RootFolderBody(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    RootFolderBody.prototype._read = function() {
      this._debug.sortIndex = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.sortIndex = this._io.readU1();
      this._debug.sortIndex.end = this._io.pos;
      this._debug.shellFolderId = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.shellFolderId = this._io.readBytes(16);
      this._debug.shellFolderId.end = this._io.pos;
    }

    return RootFolderBody;
  })();

  /**
   * @see {@link https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-SHLLINK/[MS-SHLLINK].pdf|Section 2.2.2}
   */

  var ShellItem = WindowsShellItems.ShellItem = (function() {
    function ShellItem(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    ShellItem.prototype._read = function() {
      this._debug.lenData = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenData = this._io.readU2le();
      this._debug.lenData.end = this._io.pos;
      if (this.lenData >= 2) {
        this._debug.data = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this._raw_data = this._io.readBytes(this.lenData - 2);
        var _io__raw_data = new KaitaiStream(this._raw_data);
        this.data = new ShellItemData(_io__raw_data, this, this._root);
        this.data._read();
        this._debug.data.end = this._io.pos;
      }
    }

    return ShellItem;
  })();

  var ShellItemData = WindowsShellItems.ShellItemData = (function() {
    function ShellItemData(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    ShellItemData.prototype._read = function() {
      this._debug.code = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.code = this._io.readU1();
      this._debug.code.end = this._io.pos;
      this._debug.body1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      switch (this.code) {
      case 31:
        this.body1 = new RootFolderBody(this._io, this, this._root);
        this.body1._read();
        break;
      }
      this._debug.body1.end = this._io.pos;
      this._debug.body2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      switch (this.code & 112) {
      case 32:
        this.body2 = new VolumeBody(this._io, this, this._root);
        this.body2._read();
        break;
      case 48:
        this.body2 = new FileEntryBody(this._io, this, this._root);
        this.body2._read();
        break;
      }
      this._debug.body2.end = this._io.pos;
    }

    return ShellItemData;
  })();

  /**
   * @see {@link https://github.com/libyal/libfwsi/blob/main/documentation/Windows%20Shell%20Item%20format.asciidoc#33-volume-shell-item|Source}
   */

  var VolumeBody = WindowsShellItems.VolumeBody = (function() {
    function VolumeBody(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    VolumeBody.prototype._read = function() {
      this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.flags = this._io.readU1();
      this._debug.flags.end = this._io.pos;
    }

    return VolumeBody;
  })();

  /**
   * @see {@link https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-SHLLINK/[MS-SHLLINK].pdf|Section 2.2.1}
   */

  return WindowsShellItems;
})();
WindowsShellItems_.WindowsShellItems = WindowsShellItems;
});
