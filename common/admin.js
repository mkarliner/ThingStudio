AdminConfig = {
	dashboard: {
		homeUrl: '/dashboard'
	},
	nonAdminRedirectRoute: 'entrySignIn',
	collections: {
	  	Apps: {
	  		
	  	},
		Connections: {
			tableColumns: [
				{label: "Title", name: "title"},
				{label: "Public", name: "public"},
				{label: "Owner", name: "owner", template: "Owner"}
			]
	    	},
		Screens: {
			tableColumns: [
				{label: "Title", name: "title"},
				// {label: "Owner", name: "owner", template: "Owner"}
			]
		},
		Feeds:{
			tableColumns: [
				{label: "Title", name: "title"},
				{label: "Owner", name: "owner", template: "Owner"}
			]
		},
		Themes:{
			
		},
		HelpPages:{
			tableColumns: [
			              {label: 'Page', name: 'pagenumber'},
			                {label: 'Title', name: 'title'},
			                {label: 'Last Updated', name: 'updatedAt'}
		            ]
		},
	// Users:{
	//
	// 	omitFields: ['updatedAt']
	// }
	}
};