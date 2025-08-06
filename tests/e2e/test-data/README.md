# Test DICOM Data

This directory should contain test DICOM files (.dcm) that will be automatically imported into Orthanc during E2E testing.

## Expected Files

- `ebe.dcm` - Basic DICOM file for standard testing
- `ele.dcm` - Enhanced DICOM file for IOD testing  
- `j2k.dcm` - JPEG2000 compressed DICOM file
- `pdf.dcm` - PDF encapsulated DICOM file
- `sr.dcm` - Structured report DICOM file
- `tomo.dcm` - Breast tomosynthesis
- `us-multiframe-ybr-full-422.dcm` - Multiframe ultrasound

## Adding Test Files

1. Place valid DICOM files (.dcm extension) in this directory
2. Files will be automatically imported into Orthanc when the test environment starts
3. Tests will use these files to verify proxy functionality

## Note

If no DICOM files are present, tests will skip scenarios that require test data, but basic connectivity and error handling tests will still run.