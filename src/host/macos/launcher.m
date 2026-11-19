#import <Foundation/Foundation.h>
#import <CoreServices/CoreServices.h>
#include <string.h>
#include <unistd.h>

// Start the bundled Node runtime while preserving the native messaging pipes
int main(int argc, char **argv) {
  @autoreleasepool {
    // The app containing this executable and its dedicated runtime
    NSBundle *bundle = NSBundle.mainBundle;
    // Register during installation so macOS can find this app by bundle ID
    // Direct native messaging launches do not register an app with the Finder
    if (argc == 2 && strcmp(argv[1], "--register") == 0) {
      // The result of adding or updating this bundle's Launch Services record
      OSStatus status = LSRegisterURL((__bridge CFURLRef)bundle.bundleURL, true);
      if (status != noErr) {
        fprintf(stderr, "Session Transfer Helper: app registration failed (%d)\n",
            (int)status);
        return 1;
      }
      return 0;
    }
    // The configuration contains executable paths only; never session data
    NSData *data = [NSData dataWithContentsOfURL:
        [bundle URLForResource:@"launch" withExtension:@"json"]];
    // The paths written by the TypeScript installer
    NSDictionary *configuration = data
        ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
        : nil;
    // The compiled TypeScript entry point in the developer's checkout
    NSString *entry = configuration[@"entry"];
    // The dedicated Node executable inside this app
    NSString *runtime = [bundle.executablePath.stringByDeletingLastPathComponent
        stringByAppendingPathComponent:@"node"];
    if (![entry isKindOfClass:NSString.class]) {
      fprintf(stderr, "Session Transfer Helper: missing launch configuration\n");
      return 1;
    }
    fprintf(stderr, "Session Transfer Helper: bundle=%s\n",
        bundle.bundleIdentifier.UTF8String);
    // Forward the calling extension's origin and any browser arguments
    char **arguments = calloc((size_t)argc + 2, sizeof(char *));
    if (!arguments) {
      perror("Session Transfer Helper: allocate arguments");
      return 1;
    }
    arguments[0] = (char *)runtime.fileSystemRepresentation;
    arguments[1] = (char *)entry.fileSystemRepresentation;
    // The browser argument currently being copied after the script path
    for (int index = 1; index < argc; index++) {
      arguments[index + 1] = argv[index];
    }
    // Replacing the process preserves browser-managed termination and stdio
    execv(arguments[0], arguments);
    perror("Session Transfer Helper: start bundled Node");
    free(arguments);
    return 1;
  }
}
