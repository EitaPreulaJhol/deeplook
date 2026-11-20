// This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['exports', 'kaitai-struct/KaitaiStream', './WindowsShellItems'], factory);
  } else if (typeof exports === 'object' && exports !== null && typeof exports.nodeType !== 'number') {
    factory(exports, require('kaitai-struct/KaitaiStream'), require('./WindowsShellItems'));
  } else {
    factory(root.WindowsLnkFile || (root.WindowsLnkFile = {}), root.KaitaiStream, root.WindowsShellItems || (root.WindowsShellItems = {}));
  }
})(typeof self !== 'undefined' ? self : this, function (WindowsLnkFile_, KaitaiStream, WindowsShellItems_) {
/**
 * Windows .lnk files (AKA "shell link" file) are most frequently used
 * in Windows shell to create "shortcuts" to another files, usually for
 * purposes of running a program from some other directory, sometimes
 * with certain preconfigured arguments and some other options.
 * @see {@link https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-SHLLINK/[MS-SHLLINK].pdf|Source}
 */

var WindowsLnkFile = (function() {
  WindowsLnkFile.DriveTypes = Object.freeze({
    UNKNOWN: 0,
    NO_ROOT_DIR: 1,
    REMOVABLE: 2,
    FIXED: 3,
    REMOTE: 4,
    CDROM: 5,
    RAMDISK: 6,

    0: "UNKNOWN",
    1: "NO_ROOT_DIR",
    2: "REMOVABLE",
    3: "FIXED",
    4: "REMOTE",
    5: "CDROM",
    6: "RAMDISK",
  });

  WindowsLnkFile.WindowState = Object.freeze({
    NORMAL: 1,
    MAXIMIZED: 3,
    MIN_NO_ACTIVE: 7,

    1: "NORMAL",
    3: "MAXIMIZED",
    7: "MIN_NO_ACTIVE",
  });

  function WindowsLnkFile(_io, _parent, _root) {
    this._io = _io;
    this._parent = _parent;
    this._root = _root || this;
    this._debug = {};

  }
  WindowsLnkFile.prototype._read = function() {
    this._debug.header = { start: this._io.pos, ioOffset: this._io.byteOffset };
    this.header = new FileHeader(this._io, this, this._root);
    this.header._read();
    this._debug.header.end = this._io.pos;
    if (this.header.flags.hasLinkTargetIdList) {
      this._debug.targetIdList = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.targetIdList = new LinkTargetIdList(this._io, this, this._root);
      this.targetIdList._read();
      this._debug.targetIdList.end = this._io.pos;
    }
    if (this.header.flags.hasLinkInfo) {
      this._debug.info = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.info = new LinkInfo(this._io, this, this._root);
      this.info._read();
      this._debug.info.end = this._io.pos;
    }
    if (this.header.flags.hasName) {
      this._debug.name = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.name = new StringData(this._io, this, this._root);
      this.name._read();
      this._debug.name.end = this._io.pos;
    }
    if (this.header.flags.hasRelPath) {
      this._debug.relPath = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.relPath = new StringData(this._io, this, this._root);
      this.relPath._read();
      this._debug.relPath.end = this._io.pos;
    }
    if (this.header.flags.hasWorkDir) {
      this._debug.workDir = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.workDir = new StringData(this._io, this, this._root);
      this.workDir._read();
      this._debug.workDir.end = this._io.pos;
    }
    if (this.header.flags.hasArguments) {
      this._debug.arguments = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.arguments = new StringData(this._io, this, this._root);
      this.arguments._read();
      this._debug.arguments.end = this._io.pos;
    }
    if (this.header.flags.hasIconLocation) {
      this._debug.iconLocation = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.iconLocation = new StringData(this._io, this, this._root);
      this.iconLocation._read();
      this._debug.iconLocation.end = this._io.pos;
    }
  }

  /**
   * @see {@link https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-SHLLINK/[MS-SHLLINK].pdf|Section 2.1}
   */

  var FileHeader = WindowsLnkFile.FileHeader = (function() {
    function FileHeader(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    FileHeader.prototype._read = function() {
      this._debug.lenHeader = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenHeader = this._io.readBytes(4);
      this._debug.lenHeader.end = this._io.pos;
      if (!((KaitaiStream.byteArrayCompare(this.lenHeader, new Uint8Array([76, 0, 0, 0])) == 0))) {
        var _err = new KaitaiStream.ValidationNotEqualError(new Uint8Array([76, 0, 0, 0]), this.lenHeader, this._io, "/types/file_header/seq/0");
        this._debug.lenHeader.validationError = _err;
        throw _err;
      }
      this._debug.linkClsid = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.linkClsid = this._io.readBytes(16);
      this._debug.linkClsid.end = this._io.pos;
      if (!((KaitaiStream.byteArrayCompare(this.linkClsid, new Uint8Array([1, 20, 2, 0, 0, 0, 0, 0, 192, 0, 0, 0, 0, 0, 0, 70])) == 0))) {
        var _err = new KaitaiStream.ValidationNotEqualError(new Uint8Array([1, 20, 2, 0, 0, 0, 0, 0, 192, 0, 0, 0, 0, 0, 0, 70]), this.linkClsid, this._io, "/types/file_header/seq/1");
        this._debug.linkClsid.validationError = _err;
        throw _err;
      }
      this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this._raw_flags = this._io.readBytes(4);
      var _io__raw_flags = new KaitaiStream(this._raw_flags);
      this.flags = new LinkFlags(_io__raw_flags, this, this._root);
      this.flags._read();
      this._debug.flags.end = this._io.pos;
      this._debug.fileAttrs = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.fileAttrs = this._io.readU4le();
      this._debug.fileAttrs.end = this._io.pos;
      this._debug.timeCreation = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.timeCreation = this._io.readU8le();
      this._debug.timeCreation.end = this._io.pos;
      this._debug.timeAccess = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.timeAccess = this._io.readU8le();
      this._debug.timeAccess.end = this._io.pos;
      this._debug.timeWrite = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.timeWrite = this._io.readU8le();
      this._debug.timeWrite.end = this._io.pos;
      this._debug.targetFileSize = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.targetFileSize = this._io.readU4le();
      this._debug.targetFileSize.end = this._io.pos;
      this._debug.iconIndex = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.iconIndex = this._io.readS4le();
      this._debug.iconIndex.end = this._io.pos;
      this._debug.showCommand = { start: this._io.pos, ioOffset: this._io.byteOffset, enumName: "WindowsLnkFile.WindowState" };
      this.showCommand = this._io.readU4le();
      this._debug.showCommand.end = this._io.pos;
      this._debug.hotkey = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.hotkey = this._io.readU2le();
      this._debug.hotkey.end = this._io.pos;
      this._debug.reserved = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.reserved = this._io.readBytes(10);
      this._debug.reserved.end = this._io.pos;
      if (!((KaitaiStream.byteArrayCompare(this.reserved, new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])) == 0))) {
        var _err = new KaitaiStream.ValidationNotEqualError(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), this.reserved, this._io, "/types/file_header/seq/11");
        this._debug.reserved.validationError = _err;
        throw _err;
      }
    }

    /**
     * Technically, a size of the header, but in reality, it's
     * fixed by standard.
     */

    /**
     * 16-byte class identified (CLSID), reserved for Windows shell
     * link files.
     */

    /**
     * Lower 32 bits of the size of the file that this link targets
     */

    /**
     * Index of an icon to use from target file
     */

    /**
     * Window state to set after the launch of target executable
     */

    return FileHeader;
  })();

  /**
   * @see {@link https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-SHLLINK/[MS-SHLLINK].pdf|Section 2.1.1}
   */

  var LinkFlags = WindowsLnkFile.LinkFlags = (function() {
    function LinkFlags(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    LinkFlags.prototype._read = function() {
      this._debug.isUnicode = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.isUnicode = this._io.readBitsIntBe(1) != 0;
      this._debug.isUnicode.end = this._io.pos;
      this._debug.hasIconLocation = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.hasIconLocation = this._io.readBitsIntBe(1) != 0;
      this._debug.hasIconLocation.end = this._io.pos;
      this._debug.hasArguments = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.hasArguments = this._io.readBitsIntBe(1) != 0;
      this._debug.hasArguments.end = this._io.pos;
      this._debug.hasWorkDir = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.hasWorkDir = this._io.readBitsIntBe(1) != 0;
      this._debug.hasWorkDir.end = this._io.pos;
      this._debug.hasRelPath = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.hasRelPath = this._io.readBitsIntBe(1) != 0;
      this._debug.hasRelPath.end = this._io.pos;
      this._debug.hasName = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.hasName = this._io.readBitsIntBe(1) != 0;
      this._debug.hasName.end = this._io.pos;
      this._debug.hasLinkInfo = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.hasLinkInfo = this._io.readBitsIntBe(1) != 0;
      this._debug.hasLinkInfo.end = this._io.pos;
      this._debug.hasLinkTargetIdList = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.hasLinkTargetIdList = this._io.readBitsIntBe(1) != 0;
      this._debug.hasLinkTargetIdList.end = this._io.pos;
      this._debug._unnamed8 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this._unnamed8 = this._io.readBitsIntBe(16);
      this._debug._unnamed8.end = this._io.pos;
      this._debug.reserved = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.reserved = this._io.readBitsIntBe(5);
      this._debug.reserved.end = this._io.pos;
      this._debug.keepLocalIdListForUncTarget = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.keepLocalIdListForUncTarget = this._io.readBitsIntBe(1) != 0;
      this._debug.keepLocalIdListForUncTarget.end = this._io.pos;
      this._debug._unnamed11 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this._unnamed11 = this._io.readBitsIntBe(2);
      this._debug._unnamed11.end = this._io.pos;
    }

    return LinkFlags;
  })();

  /**
   * @see {@link https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-SHLLINK/[MS-SHLLINK].pdf|Section 2.3}
   */

  var LinkInfo = WindowsLnkFile.LinkInfo = (function() {
    function LinkInfo(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    LinkInfo.prototype._read = function() {
      this._debug.lenAll = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenAll = this._io.readU4le();
      this._debug.lenAll.end = this._io.pos;
      this._debug.all = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this._raw_all = this._io.readBytes(this.lenAll - 4);
      var _io__raw_all = new KaitaiStream(this._raw_all);
      this.all = new All(_io__raw_all, this, this._root);
      this.all._read();
      this._debug.all.end = this._io.pos;
    }

    /**
     * @see {@link https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-SHLLINK/[MS-SHLLINK].pdf|Section 2.3}
     */

    var All = LinkInfo.All = (function() {
      function All(_io, _parent, _root) {
        this._io = _io;
        this._parent = _parent;
        this._root = _root;
        this._debug = {};

      }
      All.prototype._read = function() {
        this._debug.lenHeader = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.lenHeader = this._io.readU4le();
        this._debug.lenHeader.end = this._io.pos;
        this._debug.header = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this._raw_header = this._io.readBytes(this.lenHeader - 8);
        var _io__raw_header = new KaitaiStream(this._raw_header);
        this.header = new Header(_io__raw_header, this, this._root);
        this.header._read();
        this._debug.header.end = this._io.pos;
      }
      Object.defineProperty(All.prototype, 'localBasePath', {
        get: function() {
          if (this._m_localBasePath !== undefined)
            return this._m_localBasePath;
          if (this.header.flags.hasVolumeIdAndLocalBasePath) {
            var _pos = this._io.pos;
            this._io.seek(this.header.ofsLocalBasePath - 4);
            this._debug._m_localBasePath = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_localBasePath = this._io.readBytesTerm(0, false, true, true);
            this._debug._m_localBasePath.end = this._io.pos;
            this._io.seek(_pos);
          }
          return this._m_localBasePath;
        }
      });
      Object.defineProperty(All.prototype, 'volumeId', {
        get: function() {
          if (this._m_volumeId !== undefined)
            return this._m_volumeId;
          if (this.header.flags.hasVolumeIdAndLocalBasePath) {
            var _pos = this._io.pos;
            this._io.seek(this.header.ofsVolumeId - 4);
            this._debug._m_volumeId = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_volumeId = new VolumeIdSpec(this._io, this, this._root);
            this._m_volumeId._read();
            this._debug._m_volumeId.end = this._io.pos;
            this._io.seek(_pos);
          }
          return this._m_volumeId;
        }
      });

      return All;
    })();

    /**
     * @see {@link https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-SHLLINK/[MS-SHLLINK].pdf|Section 2.3}
     */

    var Header = LinkInfo.Header = (function() {
      function Header(_io, _parent, _root) {
        this._io = _io;
        this._parent = _parent;
        this._root = _root;
        this._debug = {};

      }
      Header.prototype._read = function() {
        this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.flags = new LinkInfoFlags(this._io, this, this._root);
        this.flags._read();
        this._debug.flags.end = this._io.pos;
        this._debug.ofsVolumeId = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.ofsVolumeId = this._io.readU4le();
        this._debug.ofsVolumeId.end = this._io.pos;
        this._debug.ofsLocalBasePath = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.ofsLocalBasePath = this._io.readU4le();
        this._debug.ofsLocalBasePath.end = this._io.pos;
        this._debug.ofsCommonNetRelLink = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.ofsCommonNetRelLink = this._io.readU4le();
        this._debug.ofsCommonNetRelLink.end = this._io.pos;
        this._debug.ofsCommonPathSuffix = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.ofsCommonPathSuffix = this._io.readU4le();
        this._debug.ofsCommonPathSuffix.end = this._io.pos;
        if (!(this._io.isEof())) {
          this._debug.ofsLocalBasePathUnicode = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.ofsLocalBasePathUnicode = this._io.readU4le();
          this._debug.ofsLocalBasePathUnicode.end = this._io.pos;
        }
        if (!(this._io.isEof())) {
          this._debug.ofsCommonPathSuffixUnicode = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.ofsCommonPathSuffixUnicode = this._io.readU4le();
          this._debug.ofsCommonPathSuffixUnicode.end = this._io.pos;
        }
      }

      return Header;
    })();

    /**
     * @see {@link https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-SHLLINK/[MS-SHLLINK].pdf|Section 2.3}
     */

    var LinkInfoFlags = LinkInfo.LinkInfoFlags = (function() {
      function LinkInfoFlags(_io, _parent, _root) {
        this._io = _io;
        this._parent = _parent;
        this._root = _root;
        this._debug = {};

      }
      LinkInfoFlags.prototype._read = function() {
        this._debug.reserved1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.reserved1 = this._io.readBitsIntBe(6);
        this._debug.reserved1.end = this._io.pos;
        this._debug.hasCommonNetRelLink = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.hasCommonNetRelLink = this._io.readBitsIntBe(1) != 0;
        this._debug.hasCommonNetRelLink.end = this._io.pos;
        this._debug.hasVolumeIdAndLocalBasePath = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.hasVolumeIdAndLocalBasePath = this._io.readBitsIntBe(1) != 0;
        this._debug.hasVolumeIdAndLocalBasePath.end = this._io.pos;
        this._debug.reserved2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.reserved2 = this._io.readBitsIntBe(24);
        this._debug.reserved2.end = this._io.pos;
      }

      return LinkInfoFlags;
    })();

    /**
     * @see {@link https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-SHLLINK/[MS-SHLLINK].pdf|Section 2.3.1}
     */

    var VolumeIdBody = LinkInfo.VolumeIdBody = (function() {
      function VolumeIdBody(_io, _parent, _root) {
        this._io = _io;
        this._parent = _parent;
        this._root = _root;
        this._debug = {};

      }
      VolumeIdBody.prototype._read = function() {
        this._debug.driveType = { start: this._io.pos, ioOffset: this._io.byteOffset, enumName: "WindowsLnkFile.DriveTypes" };
        this.driveType = this._io.readU4le();
        this._debug.driveType.end = this._io.pos;
        this._debug.driveSerialNumber = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.driveSerialNumber = this._io.readU4le();
        this._debug.driveSerialNumber.end = this._io.pos;
        this._debug.ofsVolumeLabel = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.ofsVolumeLabel = this._io.readU4le();
        this._debug.ofsVolumeLabel.end = this._io.pos;
        if (this.isUnicode) {
          this._debug.ofsVolumeLabelUnicode = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.ofsVolumeLabelUnicode = this._io.readU4le();
          this._debug.ofsVolumeLabelUnicode.end = this._io.pos;
        }
      }
      Object.defineProperty(VolumeIdBody.prototype, 'isUnicode', {
        get: function() {
          if (this._m_isUnicode !== undefined)
            return this._m_isUnicode;
          this._debug._m_isUnicode = {  };
          this._m_isUnicode = this.ofsVolumeLabel == 20;
          return this._m_isUnicode;
        }
      });
      Object.defineProperty(VolumeIdBody.prototype, 'volumeLabelAnsi', {
        get: function() {
          if (this._m_volumeLabelAnsi !== undefined)
            return this._m_volumeLabelAnsi;
          if (!(this.isUnicode)) {
            var _pos = this._io.pos;
            this._io.seek(this.ofsVolumeLabel - 4);
            this._debug._m_volumeLabelAnsi = { start: this._io.pos, ioOffset: this._io.byteOffset };
            this._m_volumeLabelAnsi = KaitaiStream.bytesToStr(this._io.readBytesTerm(0, false, true, true), "IBM437");
            this._debug._m_volumeLabelAnsi.end = this._io.pos;
            this._io.seek(_pos);
          }
          return this._m_volumeLabelAnsi;
        }
      });

      return VolumeIdBody;
    })();

    /**
     * @see {@link https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-SHLLINK/[MS-SHLLINK].pdf|Section 2.3.1}
     */

    var VolumeIdSpec = LinkInfo.VolumeIdSpec = (function() {
      function VolumeIdSpec(_io, _parent, _root) {
        this._io = _io;
        this._parent = _parent;
        this._root = _root;
        this._debug = {};

      }
      VolumeIdSpec.prototype._read = function() {
        this._debug.lenAll = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.lenAll = this._io.readU4le();
        this._debug.lenAll.end = this._io.pos;
        this._debug.body = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this._raw_body = this._io.readBytes(this.lenAll - 4);
        var _io__raw_body = new KaitaiStream(this._raw_body);
        this.body = new VolumeIdBody(_io__raw_body, this, this._root);
        this.body._read();
        this._debug.body.end = this._io.pos;
      }

      return VolumeIdSpec;
    })();

    return LinkInfo;
  })();

  /**
   * @see {@link https://winprotocoldoc.blob.core.windows.net/productionwindowsarchives/MS-SHLLINK/[MS-SHLLINK].pdf|Section 2.2}
   */

  var LinkTargetIdList = WindowsLnkFile.LinkTargetIdList = (function() {
    function LinkTargetIdList(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    LinkTargetIdList.prototype._read = function() {
      this._debug.lenIdList = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenIdList = this._io.readU2le();
      this._debug.lenIdList.end = this._io.pos;
      this._debug.idList = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this._raw_idList = this._io.readBytes(this.lenIdList);
      var _io__raw_idList = new KaitaiStream(this._raw_idList);
      this.idList = new WindowsShellItems_.WindowsShellItems(_io__raw_idList, null, null);
      this.idList._read();
      this._debug.idList.end = this._io.pos;
    }

    return LinkTargetIdList;
  })();

  var StringData = WindowsLnkFile.StringData = (function() {
    function StringData(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    StringData.prototype._read = function() {
      this._debug.charsStr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.charsStr = this._io.readU2le();
      this._debug.charsStr.end = this._io.pos;
      this._debug.str = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.str = KaitaiStream.bytesToStr(this._io.readBytes(this.charsStr * 2), "UTF-16LE");
      this._debug.str.end = this._io.pos;
    }

    return StringData;
  })();

  return WindowsLnkFile;
})();
WindowsLnkFile_.WindowsLnkFile = WindowsLnkFile;
});
