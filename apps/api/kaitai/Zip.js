// This is a generated file! Please edit source .ksy file and use kaitai-struct-compiler to rebuild

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['exports', 'kaitai-struct/KaitaiStream', './DosDatetime'], factory);
  } else if (typeof exports === 'object' && exports !== null && typeof exports.nodeType !== 'number') {
    factory(exports, require('kaitai-struct/KaitaiStream'), require('./DosDatetime'));
  } else {
    factory(root.Zip || (root.Zip = {}), root.KaitaiStream, root.DosDatetime || (root.DosDatetime = {}));
  }
})(typeof self !== 'undefined' ? self : this, function (Zip_, KaitaiStream, DosDatetime_) {
/**
 * ZIP is a popular archive file format, introduced in 1989 by Phil Katz
 * and originally implemented in PKZIP utility by PKWARE.
 * 
 * Thanks to solid support of it in most desktop environments and
 * operating systems, and algorithms / specs availability in public
 * domain, it quickly became tool of choice for implementing file
 * containers.
 * 
 * For example, Java .jar files, OpenDocument, Office Open XML, EPUB files
 * are actually ZIP archives.
 * @see {@link https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT|Source}
 * @see {@link https://users.cs.jmu.edu/buchhofp/forensics/formats/pkzip.html|Source}
 */

var Zip = (function() {
  Zip.Compression = Object.freeze({
    NONE: 0,
    SHRUNK: 1,
    REDUCED_1: 2,
    REDUCED_2: 3,
    REDUCED_3: 4,
    REDUCED_4: 5,
    IMPLODED: 6,
    DEFLATED: 8,
    ENHANCED_DEFLATED: 9,
    PKWARE_DCL_IMPLODED: 10,
    BZIP2: 12,
    LZMA: 14,
    IBM_TERSE: 18,
    IBM_LZ77_Z: 19,
    ZSTANDARD: 93,
    MP3: 94,
    XZ: 95,
    JPEG: 96,
    WAVPACK: 97,
    PPMD: 98,
    AEX_ENCRYPTION_MARKER: 99,

    0: "NONE",
    1: "SHRUNK",
    2: "REDUCED_1",
    3: "REDUCED_2",
    4: "REDUCED_3",
    5: "REDUCED_4",
    6: "IMPLODED",
    8: "DEFLATED",
    9: "ENHANCED_DEFLATED",
    10: "PKWARE_DCL_IMPLODED",
    12: "BZIP2",
    14: "LZMA",
    18: "IBM_TERSE",
    19: "IBM_LZ77_Z",
    93: "ZSTANDARD",
    94: "MP3",
    95: "XZ",
    96: "JPEG",
    97: "WAVPACK",
    98: "PPMD",
    99: "AEX_ENCRYPTION_MARKER",
  });

  Zip.ExtraCodes = Object.freeze({
    ZIP64: 1,
    AV_INFO: 7,
    OS2: 9,
    NTFS: 10,
    OPENVMS: 12,
    PKWARE_UNIX: 13,
    FILE_STREAM_AND_FORK_DESCRIPTORS: 14,
    PATCH_DESCRIPTOR: 15,
    PKCS7: 20,
    X509_CERT_ID_AND_SIGNATURE_FOR_FILE: 21,
    X509_CERT_ID_FOR_CENTRAL_DIR: 22,
    STRONG_ENCRYPTION_HEADER: 23,
    RECORD_MANAGEMENT_CONTROLS: 24,
    PKCS7_ENC_RECIP_CERT_LIST: 25,
    IBM_S390_UNCOMP: 101,
    IBM_S390_COMP: 102,
    POSZIP_4690: 18064,
    EXTENDED_TIMESTAMP: 21589,
    BEOS: 25922,
    ASI_UNIX: 30062,
    INFOZIP_UNIX: 30805,
    INFOZIP_UNIX_VAR_SIZE: 30837,
    AEX_ENCRYPTION: 39169,
    APACHE_COMMONS_COMPRESS: 41246,
    MICROSOFT_OPEN_PACKAGING_GROWTH_HINT: 41504,
    SMS_QDOS: 64842,

    1: "ZIP64",
    7: "AV_INFO",
    9: "OS2",
    10: "NTFS",
    12: "OPENVMS",
    13: "PKWARE_UNIX",
    14: "FILE_STREAM_AND_FORK_DESCRIPTORS",
    15: "PATCH_DESCRIPTOR",
    20: "PKCS7",
    21: "X509_CERT_ID_AND_SIGNATURE_FOR_FILE",
    22: "X509_CERT_ID_FOR_CENTRAL_DIR",
    23: "STRONG_ENCRYPTION_HEADER",
    24: "RECORD_MANAGEMENT_CONTROLS",
    25: "PKCS7_ENC_RECIP_CERT_LIST",
    101: "IBM_S390_UNCOMP",
    102: "IBM_S390_COMP",
    18064: "POSZIP_4690",
    21589: "EXTENDED_TIMESTAMP",
    25922: "BEOS",
    30062: "ASI_UNIX",
    30805: "INFOZIP_UNIX",
    30837: "INFOZIP_UNIX_VAR_SIZE",
    39169: "AEX_ENCRYPTION",
    41246: "APACHE_COMMONS_COMPRESS",
    41504: "MICROSOFT_OPEN_PACKAGING_GROWTH_HINT",
    64842: "SMS_QDOS",
  });

  function Zip(_io, _parent, _root) {
    this._io = _io;
    this._parent = _parent;
    this._root = _root || this;
    this._debug = {};

  }
  Zip.prototype._read = function() {
    this._debug.sections = { start: this._io.pos, ioOffset: this._io.byteOffset };
    this._debug.sections.arr = [];
    this.sections = [];
    var i = 0;
    while (!this._io.isEof()) {
      this._debug.sections.arr[this.sections.length] = { start: this._io.pos, ioOffset: this._io.byteOffset };
      var _t_sections = new PkSection(this._io, this, this._root);
      try {
        _t_sections._read();
      } finally {
        this.sections.push(_t_sections);
      }
      this._debug.sections.arr[this.sections.length - 1].end = this._io.pos;
      i++;
    }
    this._debug.sections.end = this._io.pos;
  }

  /**
   * @see {@link https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT|- 4.3.12}
   */

  var CentralDirEntry = Zip.CentralDirEntry = (function() {
    function CentralDirEntry(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    CentralDirEntry.prototype._read = function() {
      this._debug.versionMadeBy = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.versionMadeBy = this._io.readU2le();
      this._debug.versionMadeBy.end = this._io.pos;
      this._debug.versionNeededToExtract = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.versionNeededToExtract = this._io.readU2le();
      this._debug.versionNeededToExtract.end = this._io.pos;
      this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.flags = this._io.readU2le();
      this._debug.flags.end = this._io.pos;
      this._debug.compressionMethod = { start: this._io.pos, ioOffset: this._io.byteOffset, enumName: "Zip.Compression" };
      this.compressionMethod = this._io.readU2le();
      this._debug.compressionMethod.end = this._io.pos;
      this._debug.fileModTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this._raw_fileModTime = this._io.readBytes(4);
      var _io__raw_fileModTime = new KaitaiStream(this._raw_fileModTime);
      this.fileModTime = new DosDatetime_.DosDatetime(_io__raw_fileModTime, null, null);
      this.fileModTime._read();
      this._debug.fileModTime.end = this._io.pos;
      this._debug.crc32 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.crc32 = this._io.readU4le();
      this._debug.crc32.end = this._io.pos;
      this._debug.lenBodyCompressed = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenBodyCompressed = this._io.readU4le();
      this._debug.lenBodyCompressed.end = this._io.pos;
      this._debug.lenBodyUncompressed = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenBodyUncompressed = this._io.readU4le();
      this._debug.lenBodyUncompressed.end = this._io.pos;
      this._debug.lenFileName = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenFileName = this._io.readU2le();
      this._debug.lenFileName.end = this._io.pos;
      this._debug.lenExtra = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenExtra = this._io.readU2le();
      this._debug.lenExtra.end = this._io.pos;
      this._debug.lenComment = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenComment = this._io.readU2le();
      this._debug.lenComment.end = this._io.pos;
      this._debug.diskNumberStart = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.diskNumberStart = this._io.readU2le();
      this._debug.diskNumberStart.end = this._io.pos;
      this._debug.intFileAttr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.intFileAttr = this._io.readU2le();
      this._debug.intFileAttr.end = this._io.pos;
      this._debug.extFileAttr = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.extFileAttr = this._io.readU4le();
      this._debug.extFileAttr.end = this._io.pos;
      this._debug.ofsLocalHeader = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.ofsLocalHeader = this._io.readS4le();
      this._debug.ofsLocalHeader.end = this._io.pos;
      this._debug.fileName = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.fileName = KaitaiStream.bytesToStr(this._io.readBytes(this.lenFileName), "UTF-8");
      this._debug.fileName.end = this._io.pos;
      this._debug.extra = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this._raw_extra = this._io.readBytes(this.lenExtra);
      var _io__raw_extra = new KaitaiStream(this._raw_extra);
      this.extra = new Extras(_io__raw_extra, this, this._root);
      this.extra._read();
      this._debug.extra.end = this._io.pos;
      this._debug.comment = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.comment = KaitaiStream.bytesToStr(this._io.readBytes(this.lenComment), "UTF-8");
      this._debug.comment.end = this._io.pos;
    }
    Object.defineProperty(CentralDirEntry.prototype, 'localHeader', {
      get: function() {
        if (this._m_localHeader !== undefined)
          return this._m_localHeader;
        var _pos = this._io.pos;
        this._io.seek(this.ofsLocalHeader);
        this._debug._m_localHeader = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this._m_localHeader = new PkSection(this._io, this, this._root);
        this._m_localHeader._read();
        this._debug._m_localHeader.end = this._io.pos;
        this._io.seek(_pos);
        return this._m_localHeader;
      }
    });

    return CentralDirEntry;
  })();

  var DataDescriptor = Zip.DataDescriptor = (function() {
    function DataDescriptor(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    DataDescriptor.prototype._read = function() {
      this._debug.crc32 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.crc32 = this._io.readU4le();
      this._debug.crc32.end = this._io.pos;
      this._debug.lenBodyCompressed = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenBodyCompressed = this._io.readU4le();
      this._debug.lenBodyCompressed.end = this._io.pos;
      this._debug.lenBodyUncompressed = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenBodyUncompressed = this._io.readU4le();
      this._debug.lenBodyUncompressed.end = this._io.pos;
    }

    return DataDescriptor;
  })();

  var EndOfCentralDir = Zip.EndOfCentralDir = (function() {
    function EndOfCentralDir(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    EndOfCentralDir.prototype._read = function() {
      this._debug.diskOfEndOfCentralDir = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.diskOfEndOfCentralDir = this._io.readU2le();
      this._debug.diskOfEndOfCentralDir.end = this._io.pos;
      this._debug.diskOfCentralDir = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.diskOfCentralDir = this._io.readU2le();
      this._debug.diskOfCentralDir.end = this._io.pos;
      this._debug.numCentralDirEntriesOnDisk = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numCentralDirEntriesOnDisk = this._io.readU2le();
      this._debug.numCentralDirEntriesOnDisk.end = this._io.pos;
      this._debug.numCentralDirEntriesTotal = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.numCentralDirEntriesTotal = this._io.readU2le();
      this._debug.numCentralDirEntriesTotal.end = this._io.pos;
      this._debug.lenCentralDir = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenCentralDir = this._io.readU4le();
      this._debug.lenCentralDir.end = this._io.pos;
      this._debug.ofsCentralDir = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.ofsCentralDir = this._io.readU4le();
      this._debug.ofsCentralDir.end = this._io.pos;
      this._debug.lenComment = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenComment = this._io.readU2le();
      this._debug.lenComment.end = this._io.pos;
      this._debug.comment = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.comment = KaitaiStream.bytesToStr(this._io.readBytes(this.lenComment), "UTF-8");
      this._debug.comment.end = this._io.pos;
    }

    return EndOfCentralDir;
  })();

  var ExtraField = Zip.ExtraField = (function() {
    function ExtraField(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    ExtraField.prototype._read = function() {
      this._debug.code = { start: this._io.pos, ioOffset: this._io.byteOffset, enumName: "Zip.ExtraCodes" };
      this.code = this._io.readU2le();
      this._debug.code.end = this._io.pos;
      this._debug.lenBody = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenBody = this._io.readU2le();
      this._debug.lenBody.end = this._io.pos;
      this._debug.body = { start: this._io.pos, ioOffset: this._io.byteOffset };
      switch (this.code) {
      case Zip.ExtraCodes.EXTENDED_TIMESTAMP:
        this._raw_body = this._io.readBytes(this.lenBody);
        var _io__raw_body = new KaitaiStream(this._raw_body);
        this.body = new ExtendedTimestamp(_io__raw_body, this, this._root);
        this.body._read();
        break;
      case Zip.ExtraCodes.INFOZIP_UNIX_VAR_SIZE:
        this._raw_body = this._io.readBytes(this.lenBody);
        var _io__raw_body = new KaitaiStream(this._raw_body);
        this.body = new InfozipUnixVarSize(_io__raw_body, this, this._root);
        this.body._read();
        break;
      case Zip.ExtraCodes.NTFS:
        this._raw_body = this._io.readBytes(this.lenBody);
        var _io__raw_body = new KaitaiStream(this._raw_body);
        this.body = new Ntfs(_io__raw_body, this, this._root);
        this.body._read();
        break;
      default:
        this.body = this._io.readBytes(this.lenBody);
        break;
      }
      this._debug.body.end = this._io.pos;
    }

    /**
     * @see {@link https://github.com/LuaDist/zip/blob/b710806/proginfo/extrafld.txt#L817|Source}
     */

    var ExtendedTimestamp = ExtraField.ExtendedTimestamp = (function() {
      function ExtendedTimestamp(_io, _parent, _root) {
        this._io = _io;
        this._parent = _parent;
        this._root = _root;
        this._debug = {};

      }
      ExtendedTimestamp.prototype._read = function() {
        this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this._raw_flags = this._io.readBytes(1);
        var _io__raw_flags = new KaitaiStream(this._raw_flags);
        this.flags = new InfoFlags(_io__raw_flags, this, this._root);
        this.flags._read();
        this._debug.flags.end = this._io.pos;
        if (this.flags.hasModTime) {
          this._debug.modTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.modTime = this._io.readU4le();
          this._debug.modTime.end = this._io.pos;
        }
        if (this.flags.hasAccessTime) {
          this._debug.accessTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.accessTime = this._io.readU4le();
          this._debug.accessTime.end = this._io.pos;
        }
        if (this.flags.hasCreateTime) {
          this._debug.createTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.createTime = this._io.readU4le();
          this._debug.createTime.end = this._io.pos;
        }
      }

      var InfoFlags = ExtendedTimestamp.InfoFlags = (function() {
        function InfoFlags(_io, _parent, _root) {
          this._io = _io;
          this._parent = _parent;
          this._root = _root;
          this._debug = {};

        }
        InfoFlags.prototype._read = function() {
          this._debug.hasModTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.hasModTime = this._io.readBitsIntLe(1) != 0;
          this._debug.hasModTime.end = this._io.pos;
          this._debug.hasAccessTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.hasAccessTime = this._io.readBitsIntLe(1) != 0;
          this._debug.hasAccessTime.end = this._io.pos;
          this._debug.hasCreateTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.hasCreateTime = this._io.readBitsIntLe(1) != 0;
          this._debug.hasCreateTime.end = this._io.pos;
          this._debug.reserved = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.reserved = this._io.readBitsIntLe(5);
          this._debug.reserved.end = this._io.pos;
        }

        return InfoFlags;
      })();

      /**
       * Unix timestamp
       */

      /**
       * Unix timestamp
       */

      /**
       * Unix timestamp
       */

      return ExtendedTimestamp;
    })();

    /**
     * @see {@link https://github.com/LuaDist/zip/blob/b710806/proginfo/extrafld.txt#L1339|Source}
     */

    var InfozipUnixVarSize = ExtraField.InfozipUnixVarSize = (function() {
      function InfozipUnixVarSize(_io, _parent, _root) {
        this._io = _io;
        this._parent = _parent;
        this._root = _root;
        this._debug = {};

      }
      InfozipUnixVarSize.prototype._read = function() {
        this._debug.version = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.version = this._io.readU1();
        this._debug.version.end = this._io.pos;
        this._debug.lenUid = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.lenUid = this._io.readU1();
        this._debug.lenUid.end = this._io.pos;
        this._debug.uid = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.uid = this._io.readBytes(this.lenUid);
        this._debug.uid.end = this._io.pos;
        this._debug.lenGid = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.lenGid = this._io.readU1();
        this._debug.lenGid.end = this._io.pos;
        this._debug.gid = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.gid = this._io.readBytes(this.lenGid);
        this._debug.gid.end = this._io.pos;
      }

      /**
       * Version of this extra field, currently 1
       */

      /**
       * Size of UID field
       */

      /**
       * UID (User ID) for a file
       */

      /**
       * Size of GID field
       */

      /**
       * GID (Group ID) for a file
       */

      return InfozipUnixVarSize;
    })();

    /**
     * @see {@link https://github.com/LuaDist/zip/blob/b710806/proginfo/extrafld.txt#L191|Source}
     */

    var Ntfs = ExtraField.Ntfs = (function() {
      function Ntfs(_io, _parent, _root) {
        this._io = _io;
        this._parent = _parent;
        this._root = _root;
        this._debug = {};

      }
      Ntfs.prototype._read = function() {
        this._debug.reserved = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.reserved = this._io.readU4le();
        this._debug.reserved.end = this._io.pos;
        this._debug.attributes = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this._debug.attributes.arr = [];
        this.attributes = [];
        var i = 0;
        while (!this._io.isEof()) {
          this._debug.attributes.arr[this.attributes.length] = { start: this._io.pos, ioOffset: this._io.byteOffset };
          var _t_attributes = new Attribute(this._io, this, this._root);
          try {
            _t_attributes._read();
          } finally {
            this.attributes.push(_t_attributes);
          }
          this._debug.attributes.arr[this.attributes.length - 1].end = this._io.pos;
          i++;
        }
        this._debug.attributes.end = this._io.pos;
      }

      var Attribute = Ntfs.Attribute = (function() {
        function Attribute(_io, _parent, _root) {
          this._io = _io;
          this._parent = _parent;
          this._root = _root;
          this._debug = {};

        }
        Attribute.prototype._read = function() {
          this._debug.tag = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.tag = this._io.readU2le();
          this._debug.tag.end = this._io.pos;
          this._debug.lenBody = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.lenBody = this._io.readU2le();
          this._debug.lenBody.end = this._io.pos;
          this._debug.body = { start: this._io.pos, ioOffset: this._io.byteOffset };
          switch (this.tag) {
          case 1:
            this._raw_body = this._io.readBytes(this.lenBody);
            var _io__raw_body = new KaitaiStream(this._raw_body);
            this.body = new Attribute1(_io__raw_body, this, this._root);
            this.body._read();
            break;
          default:
            this.body = this._io.readBytes(this.lenBody);
            break;
          }
          this._debug.body.end = this._io.pos;
        }

        return Attribute;
      })();

      var Attribute1 = Ntfs.Attribute1 = (function() {
        function Attribute1(_io, _parent, _root) {
          this._io = _io;
          this._parent = _parent;
          this._root = _root;
          this._debug = {};

        }
        Attribute1.prototype._read = function() {
          this._debug.lastModTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.lastModTime = this._io.readU8le();
          this._debug.lastModTime.end = this._io.pos;
          this._debug.lastAccessTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.lastAccessTime = this._io.readU8le();
          this._debug.lastAccessTime.end = this._io.pos;
          this._debug.creationTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
          this.creationTime = this._io.readU8le();
          this._debug.creationTime.end = this._io.pos;
        }

        return Attribute1;
      })();

      return Ntfs;
    })();

    return ExtraField;
  })();

  var Extras = Zip.Extras = (function() {
    function Extras(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    Extras.prototype._read = function() {
      this._debug.entries = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this._debug.entries.arr = [];
      this.entries = [];
      var i = 0;
      while (!this._io.isEof()) {
        this._debug.entries.arr[this.entries.length] = { start: this._io.pos, ioOffset: this._io.byteOffset };
        var _t_entries = new ExtraField(this._io, this, this._root);
        try {
          _t_entries._read();
        } finally {
          this.entries.push(_t_entries);
        }
        this._debug.entries.arr[this.entries.length - 1].end = this._io.pos;
        i++;
      }
      this._debug.entries.end = this._io.pos;
    }

    return Extras;
  })();

  var LocalFile = Zip.LocalFile = (function() {
    function LocalFile(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    LocalFile.prototype._read = function() {
      this._debug.header = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.header = new LocalFileHeader(this._io, this, this._root);
      this.header._read();
      this._debug.header.end = this._io.pos;
      this._debug.body = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.body = this._io.readBytes(this.header.lenBodyCompressed);
      this._debug.body.end = this._io.pos;
    }

    return LocalFile;
  })();

  var LocalFileHeader = Zip.LocalFileHeader = (function() {
    function LocalFileHeader(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    LocalFileHeader.prototype._read = function() {
      this._debug.version = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.version = this._io.readU2le();
      this._debug.version.end = this._io.pos;
      this._debug.flags = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this._raw_flags = this._io.readBytes(2);
      var _io__raw_flags = new KaitaiStream(this._raw_flags);
      this.flags = new GpFlags(_io__raw_flags, this, this._root);
      this.flags._read();
      this._debug.flags.end = this._io.pos;
      this._debug.compressionMethod = { start: this._io.pos, ioOffset: this._io.byteOffset, enumName: "Zip.Compression" };
      this.compressionMethod = this._io.readU2le();
      this._debug.compressionMethod.end = this._io.pos;
      this._debug.fileModTime = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this._raw_fileModTime = this._io.readBytes(4);
      var _io__raw_fileModTime = new KaitaiStream(this._raw_fileModTime);
      this.fileModTime = new DosDatetime_.DosDatetime(_io__raw_fileModTime, null, null);
      this.fileModTime._read();
      this._debug.fileModTime.end = this._io.pos;
      this._debug.crc32 = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.crc32 = this._io.readU4le();
      this._debug.crc32.end = this._io.pos;
      this._debug.lenBodyCompressed = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenBodyCompressed = this._io.readU4le();
      this._debug.lenBodyCompressed.end = this._io.pos;
      this._debug.lenBodyUncompressed = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenBodyUncompressed = this._io.readU4le();
      this._debug.lenBodyUncompressed.end = this._io.pos;
      this._debug.lenFileName = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenFileName = this._io.readU2le();
      this._debug.lenFileName.end = this._io.pos;
      this._debug.lenExtra = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.lenExtra = this._io.readU2le();
      this._debug.lenExtra.end = this._io.pos;
      this._debug.fileName = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.fileName = KaitaiStream.bytesToStr(this._io.readBytes(this.lenFileName), "UTF-8");
      this._debug.fileName.end = this._io.pos;
      this._debug.extra = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this._raw_extra = this._io.readBytes(this.lenExtra);
      var _io__raw_extra = new KaitaiStream(this._raw_extra);
      this.extra = new Extras(_io__raw_extra, this, this._root);
      this.extra._read();
      this._debug.extra.end = this._io.pos;
    }

    /**
     * @see {@link https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT|- 4.4.4}
     * @see {@link https://users.cs.jmu.edu/buchhofp/forensics/formats/pkzip.html|Local file headers}
     */

    var GpFlags = LocalFileHeader.GpFlags = (function() {
      GpFlags.DeflateMode = Object.freeze({
        NORMAL: 0,
        MAXIMUM: 1,
        FAST: 2,
        SUPER_FAST: 3,

        0: "NORMAL",
        1: "MAXIMUM",
        2: "FAST",
        3: "SUPER_FAST",
      });

      function GpFlags(_io, _parent, _root) {
        this._io = _io;
        this._parent = _parent;
        this._root = _root;
        this._debug = {};

      }
      GpFlags.prototype._read = function() {
        this._debug.fileEncrypted = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.fileEncrypted = this._io.readBitsIntLe(1) != 0;
        this._debug.fileEncrypted.end = this._io.pos;
        this._debug.compOptionsRaw = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.compOptionsRaw = this._io.readBitsIntLe(2);
        this._debug.compOptionsRaw.end = this._io.pos;
        this._debug.hasDataDescriptor = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.hasDataDescriptor = this._io.readBitsIntLe(1) != 0;
        this._debug.hasDataDescriptor.end = this._io.pos;
        this._debug.reserved1 = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.reserved1 = this._io.readBitsIntLe(1) != 0;
        this._debug.reserved1.end = this._io.pos;
        this._debug.compPatchedData = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.compPatchedData = this._io.readBitsIntLe(1) != 0;
        this._debug.compPatchedData.end = this._io.pos;
        this._debug.strongEncrypt = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.strongEncrypt = this._io.readBitsIntLe(1) != 0;
        this._debug.strongEncrypt.end = this._io.pos;
        this._debug.reserved2 = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.reserved2 = this._io.readBitsIntLe(4);
        this._debug.reserved2.end = this._io.pos;
        this._debug.langEncoding = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.langEncoding = this._io.readBitsIntLe(1) != 0;
        this._debug.langEncoding.end = this._io.pos;
        this._debug.reserved3 = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.reserved3 = this._io.readBitsIntLe(1) != 0;
        this._debug.reserved3.end = this._io.pos;
        this._debug.maskHeaderValues = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.maskHeaderValues = this._io.readBitsIntLe(1) != 0;
        this._debug.maskHeaderValues.end = this._io.pos;
        this._debug.reserved4 = { start: this._io.pos, ioOffset: this._io.byteOffset };
        this.reserved4 = this._io.readBitsIntLe(2);
        this._debug.reserved4.end = this._io.pos;
      }
      Object.defineProperty(GpFlags.prototype, 'deflatedMode', {
        get: function() {
          if (this._m_deflatedMode !== undefined)
            return this._m_deflatedMode;
          if ( ((this._parent.compressionMethod == Zip.Compression.DEFLATED) || (this._parent.compressionMethod == Zip.Compression.ENHANCED_DEFLATED)) ) {
            this._debug._m_deflatedMode = { enumName: "Zip.LocalFileHeader.GpFlags.DeflateMode" };
            this._m_deflatedMode = this.compOptionsRaw;
          }
          return this._m_deflatedMode;
        }
      });

      /**
       * 8KiB or 4KiB in bytes
       */
      Object.defineProperty(GpFlags.prototype, 'implodedDictByteSize', {
        get: function() {
          if (this._m_implodedDictByteSize !== undefined)
            return this._m_implodedDictByteSize;
          if (this._parent.compressionMethod == Zip.Compression.IMPLODED) {
            this._debug._m_implodedDictByteSize = {  };
            this._m_implodedDictByteSize = ((this.compOptionsRaw & 1) != 0 ? 8 : 4) * 1024;
          }
          return this._m_implodedDictByteSize;
        }
      });
      Object.defineProperty(GpFlags.prototype, 'implodedNumSfTrees', {
        get: function() {
          if (this._m_implodedNumSfTrees !== undefined)
            return this._m_implodedNumSfTrees;
          if (this._parent.compressionMethod == Zip.Compression.IMPLODED) {
            this._debug._m_implodedNumSfTrees = {  };
            this._m_implodedNumSfTrees = ((this.compOptionsRaw & 2) != 0 ? 3 : 2);
          }
          return this._m_implodedNumSfTrees;
        }
      });
      Object.defineProperty(GpFlags.prototype, 'lzmaHasEosMarker', {
        get: function() {
          if (this._m_lzmaHasEosMarker !== undefined)
            return this._m_lzmaHasEosMarker;
          if (this._parent.compressionMethod == Zip.Compression.LZMA) {
            this._debug._m_lzmaHasEosMarker = {  };
            this._m_lzmaHasEosMarker = (this.compOptionsRaw & 1) != 0;
          }
          return this._m_lzmaHasEosMarker;
        }
      });

      /**
       * internal; access derived value instances instead
       */

      return GpFlags;
    })();

    return LocalFileHeader;
  })();

  var PkSection = Zip.PkSection = (function() {
    function PkSection(_io, _parent, _root) {
      this._io = _io;
      this._parent = _parent;
      this._root = _root;
      this._debug = {};

    }
    PkSection.prototype._read = function() {
      this._debug.magic = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.magic = this._io.readBytes(2);
      this._debug.magic.end = this._io.pos;
      if (!((KaitaiStream.byteArrayCompare(this.magic, new Uint8Array([80, 75])) == 0))) {
        var _err = new KaitaiStream.ValidationNotEqualError(new Uint8Array([80, 75]), this.magic, this._io, "/types/pk_section/seq/0");
        this._debug.magic.validationError = _err;
        throw _err;
      }
      this._debug.sectionType = { start: this._io.pos, ioOffset: this._io.byteOffset };
      this.sectionType = this._io.readU2le();
      this._debug.sectionType.end = this._io.pos;
      this._debug.body = { start: this._io.pos, ioOffset: this._io.byteOffset };
      switch (this.sectionType) {
      case 1027:
        this.body = new LocalFile(this._io, this, this._root);
        this.body._read();
        break;
      case 1541:
        this.body = new EndOfCentralDir(this._io, this, this._root);
        this.body._read();
        break;
      case 2055:
        this.body = new DataDescriptor(this._io, this, this._root);
        this.body._read();
        break;
      case 513:
        this.body = new CentralDirEntry(this._io, this, this._root);
        this.body._read();
        break;
      }
      this._debug.body.end = this._io.pos;
    }

    return PkSection;
  })();

  return Zip;
})();
Zip_.Zip = Zip;
});
