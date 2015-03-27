AdminConfig={
	 nonAdminRedirectRoute: 'entrySignIn',
  collections: {
    Connections: {},
	Screens: {
		tableColumns: [
			{label: "Title", name: "title"},
			{label: "Owner", name: "owner", template: "Owner"}
		]
	},
	Feeds:{
		tableColumns: [
			{label: "Title", name: "title"},
			{label: "Owner", name: "owner", template: "Owner"}
		]
	},
	Themes:{},
	HelpPages:{
		tableColumns: [
		              {label: 'Page', name: 'pagenumber'},
		                {label: 'Title', name: 'title'}
		            ],
		omitFields: ['updatedAt']
	}
  }
};