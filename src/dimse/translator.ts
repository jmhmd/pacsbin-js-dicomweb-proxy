import { DicomDataset, DicomWebStudy, DicomWebSeries, DicomWebInstance, QidoQuery } from '../types';

export class DicomWebTranslator {
  
  public static createQueryDataset(query: QidoQuery): DicomDataset {
    const dataset: DicomDataset = {};

    if (query.studyInstanceUID) {
      dataset['StudyInstanceUID'] = query.studyInstanceUID;
    }
    if (query.seriesInstanceUID) {
      dataset['SeriesInstanceUID'] = query.seriesInstanceUID;
    }
    if (query.sopInstanceUID) {
      dataset['SOPInstanceUID'] = query.sopInstanceUID;
    }
    if (query.patientName) {
      dataset['PatientName'] = query.patientName;
    }
    if (query.patientID) {
      dataset['PatientID'] = query.patientID;
    }
    if (query.accessionNumber) {
      dataset['AccessionNumber'] = query.accessionNumber;
    }
    if (query.studyDate) {
      dataset['StudyDate'] = query.studyDate;
    }
    if (query.studyTime) {
      dataset['StudyTime'] = query.studyTime;
    }
    if (query.modalitiesInStudy) {
      dataset['ModalitiesInStudy'] = query.modalitiesInStudy;
    }
    if (query.institutionName) {
      dataset['InstitutionName'] = query.institutionName;
    }

    return dataset;
  }

  public static datasetToStudy(dataset: DicomDataset): DicomWebStudy {
    return {
      StudyInstanceUID: dataset['StudyInstanceUID'] || '',
      StudyDate: dataset['StudyDate'],
      StudyTime: dataset['StudyTime'],
      AccessionNumber: dataset['AccessionNumber'],
      ReferringPhysicianName: dataset['ReferringPhysicianName'],
      PatientName: dataset['PatientName'],
      PatientID: dataset['PatientID'],
      PatientBirthDate: dataset['PatientBirthDate'],
      PatientSex: dataset['PatientSex'],
      StudyDescription: dataset['StudyDescription'],
      ModalitiesInStudy: dataset['ModalitiesInStudy'] ? 
        (Array.isArray(dataset['ModalitiesInStudy']) ? dataset['ModalitiesInStudy'] : [dataset['ModalitiesInStudy']]) : 
        undefined as string[] | undefined,
      NumberOfStudyRelatedSeries: dataset['NumberOfStudyRelatedSeries'],
      NumberOfStudyRelatedInstances: dataset['NumberOfStudyRelatedInstances'],
    };
  }

  public static datasetToSeries(dataset: DicomDataset): DicomWebSeries {
    return {
      StudyInstanceUID: dataset['StudyInstanceUID'] || '',
      SeriesInstanceUID: dataset['SeriesInstanceUID'] || '',
      SeriesDate: dataset['SeriesDate'],
      SeriesTime: dataset['SeriesTime'],
      Modality: dataset['Modality'],
      SeriesDescription: dataset['SeriesDescription'],
      SeriesNumber: dataset['SeriesNumber'],
      NumberOfSeriesRelatedInstances: dataset['NumberOfSeriesRelatedInstances'],
      BodyPartExamined: dataset['BodyPartExamined'],
      ProtocolName: dataset['ProtocolName'],
      OperatorsName: dataset['OperatorsName'],
    };
  }

  public static datasetToInstance(dataset: DicomDataset): DicomWebInstance {
    return {
      StudyInstanceUID: dataset['StudyInstanceUID'] || '',
      SeriesInstanceUID: dataset['SeriesInstanceUID'] || '',
      SOPInstanceUID: dataset['SOPInstanceUID'] || '',
      SOPClassUID: dataset['SOPClassUID'],
      InstanceNumber: dataset['InstanceNumber'],
      ContentDate: dataset['ContentDate'],
      ContentTime: dataset['ContentTime'],
      NumberOfFrames: dataset['NumberOfFrames'],
      Rows: dataset['Rows'],
      Columns: dataset['Columns'],
      BitsAllocated: dataset['BitsAllocated'],
      BitsStored: dataset['BitsStored'],
      HighBit: dataset['HighBit'],
      PixelRepresentation: dataset['PixelRepresentation'],
      PhotometricInterpretation: dataset['PhotometricInterpretation'],
      TransferSyntaxUID: dataset['TransferSyntaxUID'],
    };
  }

  public static applyWildcardMatching(value: string, minChars: number = 0, appendWildcard: boolean = true): string {
    if (!value) return '';
    
    if (value.length < minChars) {
      return value;
    }
    
    if (appendWildcard && !value.includes('*') && !value.includes('?')) {
      return `${value}*`;
    }
    
    return value;
  }

  public static convertToDicomDate(date: string): string {
    if (!date) return '';
    
    const cleanDate = date.replace(/[-\/]/g, '');
    
    if (cleanDate.length === 8) {
      return cleanDate;
    }
    
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return '';
    }
    
    return dateObj.toISOString().substring(0, 10).replace(/-/g, '');
  }

  public static convertToDicomTime(time: string): string {
    if (!time) return '';
    
    const cleanTime = time.replace(/[:]/g, '');
    
    if (cleanTime.length >= 6) {
      return cleanTime.substring(0, 6);
    }
    
    const timeObj = new Date(`2000-01-01T${time}`);
    if (isNaN(timeObj.getTime())) {
      return '';
    }
    
    return timeObj.toTimeString().substring(0, 8).replace(/:/g, '');
  }

  public static formatDicomWebDate(dicomDate: string): string {
    if (!dicomDate || dicomDate.length !== 8) return dicomDate;
    
    return `${dicomDate.substring(0, 4)}-${dicomDate.substring(4, 6)}-${dicomDate.substring(6, 8)}`;
  }

  public static formatDicomWebTime(dicomTime: string): string {
    if (!dicomTime || dicomTime.length < 6) return dicomTime;
    
    return `${dicomTime.substring(0, 2)}:${dicomTime.substring(2, 4)}:${dicomTime.substring(4, 6)}`;
  }

  public static createDicomWebResponse(data: any, contentType: string = 'application/dicom+json'): string {
    if (contentType === 'application/dicom+json') {
      return JSON.stringify(data, null, 2);
    }
    
    return JSON.stringify(data);
  }

  public static parseDicomWebQuery(queryString: string): Record<string, string> {
    const params: Record<string, string> = {};
    
    if (!queryString) return params;
    
    const pairs = queryString.split('&');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key && value) {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      }
    }
    
    return params;
  }

  public static validateStudyInstanceUID(uid: string): boolean {
    if (!uid) return false;
    
    const uidRegex = /^[0-9]+(\.[0-9]+)*$/;
    return uidRegex.test(uid) && uid.length <= 64;
  }

  public static validateSeriesInstanceUID(uid: string): boolean {
    return this.validateStudyInstanceUID(uid);
  }

  public static validateSOPInstanceUID(uid: string): boolean {
    return this.validateStudyInstanceUID(uid);
  }

  public static sanitizePatientName(name: string): string {
    if (!name) return '';
    
    return name.replace(/[^a-zA-Z0-9\s\^\-]/g, '').trim();
  }

  public static sanitizePatientID(id: string): string {
    if (!id) return '';
    
    return id.replace(/[^a-zA-Z0-9\-]/g, '').trim();
  }

  public static createMultipartBoundary(): string {
    return `----DICOMwebBoundary${Date.now()}${Math.random().toString(36).substring(2)}`;
  }

  public static createMultipartResponse(instances: Buffer[], boundary: string): Buffer {
    const parts: Buffer[] = [];
    
    for (const instance of instances) {
      const headers = [
        `--${boundary}`,
        'Content-Type: application/dicom',
        `Content-Length: ${instance.length}`,
        '',
        ''
      ].join('\r\n');
      
      parts.push(Buffer.from(headers));
      parts.push(instance);
      parts.push(Buffer.from('\r\n'));
    }
    
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    
    return Buffer.concat(parts);
  }
}